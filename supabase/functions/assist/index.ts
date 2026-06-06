// TSU Assist — support bot Edge Function.
// Health check + deterministic diagnosis + ticket creation for the client portal.
// Auth: requires a logged-in seller's JWT (verify_jwt). The seller is resolved to
// their bridge key(s) via client_users; all data access uses the service role
// server-side. The decision tree is deterministic; an LLM can later be dropped in
// purely for phrasing (see TSU-SUPPORT-BOT.md). Never exposes the bridge key.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const defaultChips = () => ([
  { t: "Run health check", a: "health" },
  { t: "Overlay isn't updating", a: "diagnose", s: "not_updating" },
  { t: "Scores not showing", a: "diagnose", s: "scores" },
  { t: "Sales not marking", a: "diagnose", s: "not_marking" },
  { t: "Open a ticket", a: "ticket" },
]);

function greeting(h: any) {
  if (!h) return "Hi! I'm TSU Assist. I couldn't find a recent connection for your overlay yet — what's going on?";
  const map: Record<string, string> = {
    live: `your overlay is **connected** (last event ${h.seconds_since_last_event}s ago)`,
    idle: `your overlay was last active ${Math.round((h.seconds_since_last_event || 0) / 60)} min ago`,
    stale: `I haven't seen activity from your overlay in a while`,
    never_connected: `your overlay hasn't connected yet`,
    revoked: `your account access is currently inactive`,
  };
  return `Hi! I'm TSU Assist 👋 Right now ${map[h.health_status] ?? "I'm checking your status"}. What can I help with?`;
}

// Deterministic diagnostic decision tree (see TSU-SUPPORT-BOT.md).
function diagnose(symptom: string, h: any) {
  const status = h?.health_status ?? "unknown";
  if (symptom === "not_updating") {
    if (status === "live")
      return esc(false, "Your bridge connection is healthy — this is almost always a client-side cache issue. In OBS, right-click your TSU overlay source → **Properties** → **Refresh cache of current page**. Also confirm the source URL matches the one in your portal.", ["Refreshed — fixed", "Still broken"]);
    if (status === "idle" || status === "stale")
      return esc(false, "Your overlay isn't actively subscribed right now. Make sure the OBS browser source is added and active, and that the URL matches your portal. Try reloading the source.", ["Reloaded — fixed", "Still broken"]);
    if (status === "never_connected")
      return esc(false, "I don't see a connection yet. Re-add the browser source using the exact overlay URL from your portal, and check your internet/ISP isn't blocking the bridge.", ["Re-added — fixed", "Still broken"]);
    return esc(true, "Your account access shows inactive — that's an account/billing item I'll route to the team.", []);
  }
  if (symptom === "scores") {
    if (!h?.scores_enabled)
      return esc(false, "Live Scores isn't enabled on your plan right now. You can enable it from **Overlay & Features**, or upgrade if it's not included.", ["Open features", "Open a ticket"]);
    return esc(false, "Live Scores is enabled and the feed is healthy ✅. Make sure the scores ticker is added to your active layout and a sport is selected.", ["That worked", "Still broken"]);
  }
  if (symptom === "not_marking") {
    if ((h?.recent_sales ?? 0) > 0)
      return esc(false, "I can see recent sales reaching the bridge ✅, so the connection is working — the issue is likely the overlay display. Try reloading your OBS source (refresh cache).", ["Reloaded — fixed", "Still broken"]);
    return esc(false, "I'm not seeing sales reach the bridge. Check that your Chrome extension is loaded and enabled on the Whatnot tab, and that it's the current version. Reload the Whatnot tab after enabling.", ["That worked", "Still broken"]);
  }
  return esc(false, "Tell me a bit more, or run a health check and I'll take a look.", ["Run health check"]);
}
function esc(escalate: boolean, reply: string, chipLabels: string[]) {
  const chips = chipLabels.map((t) =>
    /broken|ticket/i.test(t) ? { t, a: "ticket" } : { t, a: "resolved" }
  );
  return { escalate, reply, chips };
}

function priorityFor(h: any) {
  if (h?.health_status === "revoked") return "urgent";
  if (h?.health_status === "live") return "high"; // live & needing help
  return "normal";
}

async function getHealth(svc: any, key: string) {
  const { data: hrow } = await svc.from("v_overlay_health").select("*").eq("key", key).maybeSingle();
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await svc
    .from("bridge_events")
    .select("id", { count: "exact", head: true })
    .eq("bridge_key", key).eq("event_type", "team_sold").gte("occurred_at", since);
  return hrow ? { ...hrow, recent_sales: count ?? 0 } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const svc = createClient(URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const { action = "open", symptom = "", message = "", steps_tried = [] } = body;
  let bridge_key = body.bridge_key as string | undefined;

  // Resolve the seller from their JWT, then to their allowed bridge key(s).
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Not authenticated" }, 401);

  const { data: memberships } = await svc.from("client_users").select("bridge_key").eq("user_id", user.id);
  const allowed = (memberships ?? []).map((m: any) => m.bridge_key);
  if (allowed.length === 0) return json({ error: "No client linked to this account" }, 403);
  bridge_key = bridge_key && allowed.includes(bridge_key) ? bridge_key : allowed[0];

  const health = await getHealth(svc, bridge_key);

  if (action === "open" || action === "health")
    return json({ reply: greeting(health), health, chips: defaultChips() });

  if (action === "diagnose") {
    const d = diagnose(symptom, health);
    return json({ reply: d.reply, escalate: d.escalate, chips: d.chips, health });
  }

  if (action === "ticket") {
    const { data: ticket, error } = await svc.from("support_tickets").insert({
      bridge_key,
      client_name: health?.client_name ?? null,
      source: "bot",
      priority: priorityFor(health),
      subject: message || (symptom ? `Issue: ${symptom}` : "Support request from portal"),
      summary: message || null,
      steps_tried: Array.isArray(steps_tried) ? steps_tried : [],
      context: {
        health_status: health?.health_status,
        seconds_since_last_event: health?.seconds_since_last_event,
        scores_enabled: health?.scores_enabled,
        recent_sales_15m: health?.recent_sales,
        symptom,
      },
    }).select("id, priority").single();
    if (error) return json({ error: error.message }, 500);
    return json({
      reply: `Done — ticket **#${ticket.id}** created and sent to support with your context attached (status, recent activity, and the steps we tried). You'll get an email update — typically within a few hours.`,
      ticket,
      chips: [{ t: "Run health check", a: "health" }, { t: "Done", a: "done" }],
    });
  }

  return json({ error: "Unknown action" }, 400);
});
