// TSU billing-portal — creates a Stripe Billing Portal session so a seller can
// manage their card, view invoices, or cancel. JWT-protected; resolves the seller
// (or an admin "View as") to their bridge key, looks up the Stripe customer_id,
// and returns a one-time portal URL.
// REQUIRES: STRIPE_SECRET_KEY in Supabase edge secrets, and the Stripe Customer
// Portal activated once in the Stripe dashboard (Settings → Billing → Customer portal).
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";

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
  if (!STRIPE_SECRET) return json({ error: "Billing is not configured yet.", code: "no_secret" }, 503);

  const svc = createClient(URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  let bridge_key = body.bridge_key as string | undefined;
  const return_url =
    (typeof body.return_url === "string" && body.return_url) || "https://portal.tradesecretsunlocked.com";

  // Resolve the seller from their JWT, then to their allowed bridge key(s).
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Not authenticated" }, 401);

  const { data: memberships } = await svc.from("client_users").select("bridge_key").eq("user_id", user.id);
  const allowed = (memberships ?? []).map((m: any) => m.bridge_key);
  // Admins (app_admins) may act on ANY client by passing bridge_key ("View as").
  const { data: adminRow } = await svc.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  const isAdmin = !!adminRow;
  if (bridge_key && (isAdmin || allowed.includes(bridge_key))) {
    // use bridge_key as given
  } else if (allowed.length) {
    bridge_key = allowed[0];
  } else {
    return json({ error: "No client linked to this account" }, 403);
  }

  const { data: billing } = await svc.from("client_billing").select("customer_id").eq("key", bridge_key).maybeSingle();
  const customer = billing?.customer_id;
  if (!customer)
    return json({ error: "No billing account on file yet — subscribe first to manage billing.", code: "no_customer" }, 404);

  const resp = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_SECRET}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ customer, return_url }),
  });
  const data = await resp.json();
  if (!resp.ok) return json({ error: data?.error?.message || "Could not open billing portal." }, 502);
  return json({ url: data.url });
});
