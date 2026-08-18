import express from "express";
import cors from "cors";

import { PORT, PUBLIC_BASE_URL, ADMIN_TOKENS, assertBootConfig, V } from "./src/config.js";
import { log } from "./src/log.js";
import { authRouter } from "./src/auth.js";
import { webhookRouter } from "./src/webhook.js";
import { addClient, clientCount, connectedKeys } from "./src/sse.js";
import { isActiveBridgeKey, isTikTokProvisioned, getShopAuthByBridgeKey, db } from "./src/store.js";
import { startWorkers, reconcileAll } from "./src/poller.js";
import { ensureFreshToken, listWebhooks, putWebhook } from "./src/tiktokClient.js";

assertBootConfig();

const app = express();
app.disable("x-powered-by");
app.use(cors());

/**
 * ORDER MATTERS. express.raw() must be mounted on the webhook route BEFORE the global
 * json() parser, because the webhook signature is computed over the raw body bytes.
 * If json() gets there first the buffer is gone and every webhook fails verification.
 */
app.use("/tiktok/webhook", express.raw({ type: "*/*", limit: "1mb" }), webhookRouter);

app.use(express.json({ limit: "1mb" }));

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

app.get("/health", async (_req, res) => {
  let dbOk = false;
  try {
    const { error } = await db.from("bridge_keys").select("key").limit(1);
    dbOk = !error;
  } catch {
    dbOk = false;
  }

  res.json({
    ok: true,
    service: "tsu-tiktok-bridge",
    version: "2.0.0",
    platform: "tiktok",
    db: dbOk,
    sseClients: clientCount(),
    connectedKeys: connectedKeys().length,
    apiVersions: V,
    ts: Date.now(),
  });
});

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

app.use("/tiktok", authRouter);

/* ------------------------------------------------------------------ */
/* SSE for overlays                                                    */
/* ------------------------------------------------------------------ */

/**
 * Isolation is BY BRIDGE KEY. The key is baked into the overlay file, exactly as on
 * the main bridge. ?key= stays available as a debugging override only, never as the
 * deployment mechanism.
 *
 * Channels: "main" for sales, "sports" for scores. Nothing else, ever.
 */
app.get("/stream", async (req, res) => {
  const bridgeKey = String(req.query.key || req.get("x-bridge-key") || "").trim();
  const channel = String(req.query.channel || "main").trim();

  if (!bridgeKey) return res.status(401).end("bridge key required");
  if (channel !== "main" && channel !== "sports") {
    return res.status(400).end('channel must be "main" or "sports"');
  }
  if (!(await isActiveBridgeKey(bridgeKey))) return res.status(403).end("invalid bridge key");
  if (!(await isTikTokProvisioned(bridgeKey))) {
    // entitled true + enabled true, both required. This is the check that stops a
    // client seeing another platform's data because someone half-provisioned them.
    return res.status(403).end("client is not provisioned for tiktok");
  }

  addClient(bridgeKey, channel, req, res);
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKENS.length) return res.status(503).json({ error: "admin disabled, ADMIN_TOKENS not configured" });
  const token = (req.get("x-admin-token") || "").trim();
  if (!token || !ADMIN_TOKENS.includes(token)) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/admin/status/:bridgeKey", requireAdmin, async (req, res) => {
  try {
    const auth = await getShopAuthByBridgeKey(req.params.bridgeKey);
    if (!auth) return res.status(404).json({ error: "no active tiktok authorization for this bridge key" });
    res.json({
      bridge_key: auth.bridge_key,
      shop_id: auth.shop_id,
      shop_name: auth.shop_name,
      seller_name: auth.seller_name,
      status: auth.status,
      granted_scopes: auth.granted_scopes,
      access_expires_at: auth.access_expires_at,
      refresh_expires_at: auth.refresh_expires_at,
      last_refresh_at: auth.last_refresh_at,
      last_error: auth.last_error,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Registers the webhook topics TSU depends on. One address per (shop, event_type). */
app.post("/admin/webhooks/:bridgeKey", requireAdmin, async (req, res) => {
  try {
    const auth = await getShopAuthByBridgeKey(req.params.bridgeKey);
    if (!auth) return res.status(404).json({ error: "no active authorization" });

    const fresh = await ensureFreshToken(auth);
    const address = `${PUBLIC_BASE_URL}/tiktok/webhook`;
    const topics = ["ORDER_STATUS_CHANGE", "SELLER_DEAUTHORIZATION", "UPCOMING_AUTHORIZATION_EXPIRATION"];

    const results = [];
    for (const eventType of topics) {
      try {
        await putWebhook({
          accessToken: fresh.access_token,
          shopCipher: fresh.shop_cipher,
          address,
          eventType,
        });
        results.push({ eventType, ok: true });
      } catch (e) {
        results.push({ eventType, ok: false, error: e.message });
      }
    }

    const current = await listWebhooks({
      accessToken: fresh.access_token,
      shopCipher: fresh.shop_cipher,
    });

    res.json({ address, results, current });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/admin/reconcile", requireAdmin, async (_req, res) => {
  reconcileAll().catch((e) => log.error("manual reconcile failed", { error: e.message }));
  res.json({ ok: true, note: "reconciliation started in the background" });
});

/* ------------------------------------------------------------------ */

app.use((req, res) => res.status(404).json({ error: "not found", path: req.path }));

app.use((err, _req, res, _next) => {
  log.error("unhandled error", { error: err.message });
  res.status(500).json({ error: "internal error" });
});

const server = app.listen(PORT, () => {
  log.info("tsu-tiktok-bridge listening", {
    port: PORT,
    public_base_url: PUBLIC_BASE_URL,
    webhook: `${PUBLIC_BASE_URL}/tiktok/webhook`,
    callback: `${PUBLIC_BASE_URL}/tiktok/callback`,
  });
  startWorkers();
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log.info("shutting down", { signal: sig });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

export { app, server };
