// TSU toggle-feature — lets a seller flip their own self-service features safely.
// Plan-gated features stay 'managed' (returns 403) so sellers can't enable
// something they're not entitled to. Auth via JWT → client_users → bridge key.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// Features a seller may toggle themselves. Everything else is plan-managed.
const SELF_SERVICE = new Set(["scores"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
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
  const allowed = (memberships ?? []).map((m: any) => m.bridge_key);
  if (allowed.length === 0) return json({ error: "No client linked" }, 403);
  bridge_key = bridge_key && allowed.includes(bridge_key) ? bridge_key : allowed[0];

  if (typeof service !== "string" || typeof enabled !== "boolean")
    return json({ error: "service (string) and enabled (boolean) required" }, 400);

  if (!SELF_SERVICE.has(service))
    return json({ error: "This feature is managed by your plan — contact support or upgrade to change it.", code: "managed" }, 403);

  const { error } = await svc.from("client_services")
    .upsert({ key: bridge_key, service, enabled }, { onConflict: "key,service" });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, service, enabled });
});
