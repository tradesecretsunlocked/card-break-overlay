// TSU provision-client — one-step seller onboarding. ADMIN ONLY (caller must be
// in app_admins). Creates the bridge key + billing/settings/feature rows, creates
// or invites the seller's auth account, and links them via client_users.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_REDIRECT = "https://portal.tradesecretsunlocked.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const VALID_TIERS = new Set(["local", "pro", "elite", "custom", "legacy"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const svc = createClient(URL, SERVICE);

  // --- authz: caller must be a logged-in admin ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Not authenticated" }, 401);
  const { data: admin } = await svc.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) return json({ error: "Admin only" }, 403);

  // --- input ---
  const body = await req.json().catch(() => ({}));
  const email = (body.email || "").trim().toLowerCase();
  const client_name = (body.client_name || "").trim();
  if (!email || !client_name) return json({ error: "email and client_name are required" }, 400);
  const tier = VALID_TIERS.has(body.tier) ? body.tier : "pro";
  const grandfathered = !!body.grandfathered;
  const founding_member = !!body.founding_member;
  const monthly_amount = body.monthly_amount != null ? Number(body.monthly_amount) : null;
  const total_slots = body.total_slots != null ? Number(body.total_slots) : null;
  const send_invite = body.send_invite !== false;
  const redirect_to = body.redirect_to || DEFAULT_REDIRECT;
  const key = (body.bridge_key || crypto.randomUUID());

  const { data: catalog } = await svc.from("service_catalog").select("service");
  const known = new Set((catalog ?? []).map((c: any) => c.service));
  const features = Array.isArray(body.features) ? body.features.filter((f: string) => known.has(f)) : ["hosting", "automation"];

  const status = grandfathered ? "grandfathered" : (monthly_amount && monthly_amount > 0 ? "active" : "none");

  try {
    let r = await svc.from("bridge_keys").upsert({ key, client_name, active: true }, { onConflict: "key" });
    if (r.error) throw r.error;
    r = await svc.from("client_billing").upsert({ key, tier, subscription_status: status, monthly_amount, grandfathered, founding_member }, { onConflict: "key" });
    if (r.error) throw r.error;
    r = await svc.from("client_settings").upsert({ key, default_total_slots: total_slots }, { onConflict: "key" });
    if (r.error) throw r.error;
    if (features.length) {
      r = await svc.from("client_services").upsert(features.map((service: string) => ({ key, service, enabled: true })), { onConflict: "key,service" });
      if (r.error) throw r.error;
    }

    let userId: string, invited = false;
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = (list?.users ?? []).find((u: any) => (u.email || "").toLowerCase() === email);
    if (existing) {
      userId = existing.id;
    } else if (send_invite) {
      const { data, error } = await svc.auth.admin.inviteUserByEmail(email, { redirectTo: redirect_to });
      if (error) throw error;
      userId = data.user.id; invited = true;
    } else {
      const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true });
      if (error) throw error;
      userId = data.user.id;
    }

    r = await svc.from("client_users").upsert({ user_id: userId, bridge_key: key }, { onConflict: "user_id,bridge_key" });
    if (r.error) throw r.error;

    return json({ ok: true, bridge_key: key, user_id: userId, invited, tier, status, features });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
