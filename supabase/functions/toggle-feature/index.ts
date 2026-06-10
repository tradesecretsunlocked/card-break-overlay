// TSU toggle-feature v5 — entitlement-aware self-service feature toggling.
// A seller may flip a feature's on/off (enabled) state only when they are
// ENTITLED to it AND it is self_serviceable (per service_catalog).
//  - not entitled  -> 403 code:"upgrade"  (portal routes to Billing)
//  - not self-serviceable -> 403 code:"managed"
// Admins (app_admins) may toggle/grant anything ("View as"). A seller never
// grants their own entitlement. Auth via JWT -> client_users -> bridge key.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const svc = createClient(URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const { service, enabled } = body;
  let bridge_key = body.bridge_key;

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Not authenticated" }, 401);

  const { data: memberships } = await svc.from("client_users").select("bridge_key").eq("user_id", user.id);
  const allowed = (memberships ?? []).map((m) => m.bridge_key);
  const { data: adminRow } = await svc.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  const isAdmin = !!adminRow;
  if (bridge_key && (isAdmin || allowed.includes(bridge_key))) {
    // use bridge_key as given (admin view-as, or seller's own key)
  } else if (allowed.length) {
    bridge_key = allowed[0];
  } else {
    return json({ error: "No client linked" }, 403);
  }

  if (typeof service !== "string" || typeof enabled !== "boolean")
    return json({ error: "service (string) and enabled (boolean) required" }, 400);

  const { data: cat } = await svc.from("service_catalog")
    .select("self_serviceable").eq("service", service).maybeSingle();
  const { data: row } = await svc.from("client_services")
    .select("entitled").eq("key", bridge_key).eq("service", service).maybeSingle();
  const entitled = !!row?.entitled;

  if (!entitled && !isAdmin)
    return json({ error: "This feature isn't on your plan — upgrade to enable it.", code: "upgrade" }, 403);
  if (!cat?.self_serviceable && !isAdmin)
    return json({ error: "This feature is managed by your plan — contact support to change it.", code: "managed" }, 403);

  const { error } = await svc.from("client_services")
    .upsert({ key: bridge_key, service, enabled, entitled: entitled || isAdmin }, { onConflict: "key,service" });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, service, enabled, entitled: entitled || isAdmin });
});
