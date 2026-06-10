// TSU sync-orders — pulls the Notion Build Queue + linked Transactions into the
// Supabase `orders` table (the seller-facing order tracker read-model).
// Auth: verify_jwt OFF; requires header x-sync-secret == SYNC_SECRET. Call on a
// schedule (cron / scheduled task) or on-demand by an admin.
// REQUIRES env: NOTION_TOKEN (a Notion integration shared with the Build Queue DB),
// SYNC_SECRET, optional NOTION_BUILD_QUEUE_DB (defaults to the known DB id).
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") || "";
const SYNC_SECRET = Deno.env.get("SYNC_SECRET") || "";
const DB = Deno.env.get("NOTION_BUILD_QUEUE_DB") || "32d7e2ad-ff2f-809a-b2ea-c090c751cbb7";
const NV = "2022-06-28";

// internal Notion Queue Status -> client-facing lifecycle stage
const STATUS_MAP: Record<string, string> = {
  "Pending": "in_queue", "Processing": "in_build", "Done": "delivered", "failed": "in_queue",
};

function txt(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title || []).map((t: any) => t.plain_text).join("");
  if (prop.type === "rich_text") return (prop.rich_text || []).map((t: any) => t.plain_text).join("");
  if (prop.type === "email") return prop.email || "";
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "date") return prop.date?.start || "";
  return "";
}

async function notion(path: string, init: any = {}) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": NV, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Notion ${path} -> ${r.status}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!SYNC_SECRET || req.headers.get("x-sync-secret") !== SYNC_SECRET) return new Response("forbidden", { status: 403 });
  if (!NOTION_TOKEN) return new Response(JSON.stringify({ error: "NOTION_TOKEN not set" }), { status: 503, headers: { "Content-Type": "application/json" } });

  const svc = createClient(URL, SERVICE);
  const q = await notion(`/databases/${DB}/query`, { method: "POST", body: JSON.stringify({ page_size: 100 }) });
  let synced = 0;

  for (const page of q.results || []) {
    const p = page.properties || {};
    const buildName = txt(p["Build Name"]);
    const queueStatus = txt(p["Queue Status"]);
    const outputFile = txt(p["Output File"]);

    let email = "", amount: number | null = null, product = buildName, due = "";
    const rel = (p["Transactions"]?.relation) || [];
    if (rel[0]?.id) {
      try {
        const tx = await notion(`/pages/${rel[0].id}`);
        const tp = tx.properties || {};
        email = txt(tp["Email"]);
        amount = tp["Amount"]?.number ?? null;
        product = txt(tp["Product"]) || buildName;
        due = tp["Due Date"]?.date?.start || "";
      } catch (_) { /* ignore a single bad relation */ }
    }
    if (!email) continue; // can't scope an order to a seller without an email

    let status = STATUS_MAP[queueStatus] || "received";
    if (queueStatus === "Processing" && outputFile) status = "review";
    const action_needed = queueStatus === "failed" ? "We need a bit more info — we'll reach out" : null;

    await svc.from("orders").upsert({
      order_number: page.id,
      notion_page: page.url || null,
      client_email: email,
      product, order_type: "new_overlay", amount,
      status, action_needed,
      due_date: due || null,
      updated_at: new Date().toISOString(),
      delivered_at: status === "delivered" ? new Date().toISOString() : null,
    }, { onConflict: "order_number" });
    synced++;
  }
  return new Response(JSON.stringify({ ok: true, synced }), { headers: { "Content-Type": "application/json" } });
});
