// TSU stripe-webhook — ties Stripe subscriptions to client access.
// verify_jwt is FALSE on purpose: Stripe doesn't send a Supabase JWT; this function
// authenticates via the Stripe webhook SIGNATURE (STRIPE_WEBHOOK_SECRET) instead.
// On checkout/subscription events it updates client_billing and flips
// bridge_keys.active — but NEVER for grandfathered clients.
// Webhook endpoint URL: https://znyryhgjghjsobkzyfbx.supabase.co/functions/v1/stripe-webhook
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

// Map Stripe price amount (cents) -> meaning. Adjust if you change prices.
function interpret(amountCents: number) {
  switch (amountCents) {
    case 2900:  return { kind: "tier", tier: "pro",   monthly: 29, interval: "month" };
    case 29000: return { kind: "tier", tier: "pro",   monthly: 29, interval: "year" };
    case 4900:  return { kind: "tier", tier: "elite", monthly: 49, interval: "month" };
    case 49000: return { kind: "tier", tier: "elite", monthly: 49, interval: "year" };
    case 1200:  return { kind: "founding", monthly: 12, interval: "month" };
    case 12000: return { kind: "founding", monthly: 12, interval: "year" };
    default:    return { kind: "unknown" };
  }
}

async function verifyStripeSig(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts: Record<string, string> = {};
    sigHeader.split(",").forEach((kv) => { const [k, v] = kv.split("="); if (k && v) (parts[k] ??= v); });
    const t = parts["t"]; const v1 = parts["v1"];
    if (!t || !v1) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== v1.length) return false;
    let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}

const svc = createClient(URL, SERVICE);

async function setBilling(key: string, patch: Record<string, unknown>) {
  const { data: row } = await svc.from("client_billing").select("grandfathered").eq("key", key).maybeSingle();
  if (row?.grandfathered && patch.subscription_status && patch.subscription_status !== "active") {
    delete (patch as any).subscription_status;
  }
  await svc.from("client_billing").upsert({ key, ...patch }, { onConflict: "key" });
}
async function setActive(key: string, active: boolean) {
  const { data: row } = await svc.from("client_billing").select("grandfathered").eq("key", key).maybeSingle();
  if (row?.grandfathered && !active) return; // never cut off grandfathered clients
  await svc.from("bridge_keys").update({ active }).eq("key", key);
}
async function keyForSubscription(subId: string): Promise<string | null> {
  const { data } = await svc.from("client_billing").select("key").eq("subscription_id", subId).maybeSingle();
  return data?.key ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  if (!WEBHOOK_SECRET || !(await verifyStripeSig(body, sig, WEBHOOK_SECRET)))
    return new Response("bad signature", { status: 400 });

  let event: any; try { event = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  const obj = event?.data?.object ?? {};

  try {
    if (event.type === "checkout.session.completed") {
      const key = obj.client_reference_id;            // portal passes the bridge_key here
      if (key) {
        const info = interpret(obj.amount_total ?? 0);
        const patch: Record<string, unknown> = { provider: "stripe", customer_id: obj.customer ?? null, subscription_id: obj.subscription ?? null };
        if (info.kind === "tier") { patch.tier = info.tier; patch.subscription_status = "active"; patch.monthly_amount = info.monthly ?? (obj.amount_total ?? 0) / 100; }
        else if (info.kind === "founding") { patch.founding_member = true; patch.subscription_status = "active"; patch.monthly_amount = info.monthly ?? 12; }
        await setBilling(key, patch);
        if (info.kind === "tier") await setActive(key, true);
      }
    } else if (event.type === "customer.subscription.updated") {
      const key = await keyForSubscription(obj.id);
      if (key) {
        const status = obj.status === "active" || obj.status === "trialing" ? "active"
                     : obj.status === "past_due" || obj.status === "unpaid" ? "past_due" : "canceled";
        await setBilling(key, { subscription_status: status, current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null });
        await setActive(key, status === "active");
      }
    } else if (event.type === "customer.subscription.deleted") {
      const key = await keyForSubscription(obj.id);
      if (key) { await setBilling(key, { subscription_status: "canceled" }); await setActive(key, false); }
    }
  } catch (e) {
    console.error("stripe-webhook error", String(e));
    return new Response("handler error", { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
