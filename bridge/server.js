/**
 * TSU Multi-Tenant Bridge Server
 * ─────────────────────────────────────────────────────────────────────────────
 * One Render service replaces N per-client bridges.
 * Routing namespace = bridge key (32-char hex).  Each key gets its own isolated
 * channel map so events are never cross-contaminated between clients.
 *
 * Supported URL formats (backward-compatible with all existing overlays):
 *   SSE subscribe:
 *     GET /stream?channel=main&key={bridgeKey}        ← 218-style hosted overlays
 *     GET /events?channel=main&key={bridgeKey}        ← older format alias
 *     GET /?key={bridgeKey}&channel=main              ← flatbill-style draft overlays
 *   Publish (Chrome extension → bridge):
 *     POST /events   body: { channel, type, ... }   headers: x-bridge-key / x-api-key
 *     POST /event    (alias)
 *   Health:
 *     GET /health
 *   Client connection count (optional monitoring):
 *     GET /status?key={bridgeKey}
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// ─── Config ─────────────────────────────────────────────────────────────────

const PORT          = parseInt(process.env.PORT || "10000", 10);
const SUPABASE_URL  = process.env.SUPABASE_URL  || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const ESPN_ENABLED  = process.env.ESPN_ENABLED !== "false";
const HEARTBEAT_MS  = 25_000;
const ESPN_POLL_MS  = 15_000;
const KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — revocation takes effect within this window

// ─── Supabase (optional — logging degrades gracefully if not configured) ─────

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("[bridge] Supabase connected");
} else {
  console.warn("[bridge] SUPABASE_URL / SUPABASE_ANON_KEY not set — event logging disabled");
}

// ─── Key validation (Supabase-backed, in-memory cache) ───────────────────────
// Table: bridge_keys (key TEXT PRIMARY KEY, client_name TEXT, active BOOLEAN DEFAULT true)
// Revoke a client: set active = false in Supabase — takes effect within KEY_CACHE_TTL ms.

const keyCache = new Map(); // key → { valid: boolean, clientName: string, ts: number }

async function validateKey(key) {
  // No Supabase configured → open mode (backward compat for local dev / unset env)
  if (!supabase) return { valid: true, clientName: `key-${key.slice(-6)}` };

  // Serve from cache if fresh
  const cached = keyCache.get(key);
  if (cached && Date.now() - cached.ts < KEY_CACHE_TTL) {
    return { valid: cached.valid, clientName: cached.clientName };
  }

  // Query Supabase — fetch active flag AND client_name in one call
  try {
    const { data, error } = await supabase
      .from("bridge_keys")
      .select("active, client_name")
      .eq("key", key)
      .single();

    const valid      = !error && data?.active === true;
    const clientName = data?.client_name || `key-${key.slice(-6)}`;
    keyCache.set(key, { valid, clientName, ts: Date.now() });
    if (!valid) console.warn(`[${clientName}] Key rejected`);
    return { valid, clientName };
  } catch (err) {
    // Supabase down → fail open so a Supabase outage doesn't kill live streams
    console.error("[bridge] Key validation error (failing open):", err.message);
    return { valid: true, clientName: `key-${key.slice(-6)}` };
  }
}

// Middleware: extracts + validates key, attaches req.bridgeKey + req.clientName
async function authMiddleware(req, res, next) {
  const key = extractKey(req);
  if (!key) return res.status(401).json({ error: "Missing bridge key" });

  const { valid, clientName } = await validateKey(key);
  if (!valid) return res.status(403).json({ error: "Invalid or revoked bridge key" });

  req.bridgeKey  = key;
  req.clientName = clientName;
  next();
}

// High-frequency noise events: still broadcast live, but never persisted.
// These (ESPN score relays + stream-stat heartbeats) were ~89% of all rows and
// carry no business value. See TSU Phase 2 retention policy (2026-06-05).
const NO_LOG_EVENT_TYPES = new Set(["scores", "stream_stats"]);

async function logEvent(bridgeKey, clientName, channel, payload) {
  if (!supabase) return;
  const eventType = payload.type || "unknown";
  if (NO_LOG_EVENT_TYPES.has(eventType)) return; // skip noise — keep bridge_events a clean business log
  try {
    await supabase.from("bridge_events").insert({
      bridge_key:  bridgeKey,
      client_name: clientName,
      channel,
      event_type:  eventType,
      payload,
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    // Non-fatal — never let logging crash the broadcast path
    console.error(`[${clientName}] Supabase log error:`, err.message);
  }
}

// ─── Per-client feature flags (client_services) ──────────────────────────────
// Table: client_services (key, service, enabled). A client receives a gated
// feature only when they have that service row enabled. Refreshed on an interval
// so toggling a flag in Supabase takes effect within FLAG_REFRESH_MS.
const FLAG_REFRESH_MS = 60_000;
let scoresEnabledKeys = new Set(); // bridge keys with the "scores" service enabled

async function refreshFeatureFlags() {
  if (!supabase) return; // no DB → gating handled at call site (fail open for dev)
  try {
    const { data, error } = await supabase
      .from("client_services")
      .select("key")
      .eq("service", "scores")
      .eq("enabled", true);
    if (!error && Array.isArray(data)) {
      scoresEnabledKeys = new Set(data.map((r) => r.key));
    }
  } catch (err) {
    // Keep the last known set on error so a Supabase blip doesn't kill live scores.
    console.error("[bridge] feature-flag refresh error (keeping last set):", err.message);
  }
}

function scoresEnabledFor(bridgeKey) {
  if (!supabase) return true; // no DB configured (local/dev) → don't gate
  return scoresEnabledKeys.has(bridgeKey);
}

// ─── Multi-tenant connection registry ────────────────────────────────────────
// Structure: Map<bridgeKey → Map<channel → Set<Response>>>

const clients = new Map(); // bridgeKey → Map<channel → Set<res>>

function getChannelSet(bridgeKey, channel) {
  if (!clients.has(bridgeKey)) clients.set(bridgeKey, new Map());
  const byChannel = clients.get(bridgeKey);
  if (!byChannel.has(channel)) byChannel.set(channel, new Set());
  return byChannel.get(channel);
}

function broadcast(bridgeKey, channel, payload) {
  const set = getChannelSet(bridgeKey, channel);
  if (set.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch (_) { /* stale connection — cleanup handled by close */ }
  }
}

function connCount(bridgeKey) {
  if (!clients.has(bridgeKey)) return 0;
  let total = 0;
  for (const set of clients.get(bridgeKey).values()) total += set.size;
  return total;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

function extractKey(req) {
  return (
    req.headers["x-bridge-key"] ||
    req.headers["x-api-key"] ||
    (req.headers["authorization"] || "").replace(/^bearer\s+/i, "") ||
    req.query.key ||
    ""
  ).trim();
}

function requireKey(req, res) {
  const key = extractKey(req);
  if (!key) {
    res.status(401).json({ error: "Missing bridge key" });
    return null;
  }
  return key;
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "64kb" }));

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    clients: clients.size,
    ts: Date.now(),
  });
});

// ─── Connection status (per-key) ─────────────────────────────────────────────

app.get("/status", authMiddleware, (req, res) => {
  const key = req.bridgeKey;
  res.json({ key_prefix: key.slice(0, 6) + "…", connections: connCount(key) });
});

// ─── SSE subscribe handler ────────────────────────────────────────────────────
// Handles:  GET /stream   GET /events   GET /

function sseHandler(req, res) {
  const key = req.bridgeKey; // set by authMiddleware
  const channel = String(req.query.channel || "main").toLowerCase();

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // Nginx pass-through
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Hello frame
  res.write(
    `data: ${JSON.stringify({ type: "hello", channel, ts: Date.now() })}\n\n`
  );

  // Register
  const set        = getChannelSet(key, channel);
  const clientName = req.clientName || `key-${key.slice(-6)}`;
  set.add(res);
  console.log(`[${clientName}] +connect  ch=${channel}  listeners=${connCount(key)}`);

  // Heartbeat
  const ping = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch (_) { clearInterval(ping); }
  }, HEARTBEAT_MS);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(ping);
    set.delete(res);
    console.log(`[${clientName}] -connect  ch=${channel}  listeners=${connCount(key)}`);
  });
}

app.get("/stream", authMiddleware, sseHandler);
app.get("/events", authMiddleware, sseHandler); // legacy GET alias
app.get("/",       authMiddleware, sseHandler); // flatbill-style: GET /?key=…

// ─── Publish event (Chrome extension → bridge → overlays) ────────────────────

function publishHandler(req, res) {
  const key        = req.bridgeKey;  // set by authMiddleware
  const clientName = req.clientName || `key-${key.slice(-6)}`;
  const body       = req.body || {};
  const channel    = String(body.channel || req.query.channel || "main").toLowerCase();
  const payload    = { ts: Date.now(), ...body, channel };
  const eventType  = payload.type || "unknown";

  broadcast(key, channel, payload);
  console.log(`[${clientName}] event=${eventType}  ch=${channel}  listeners=${connCount(key)}`);

  // Fire-and-forget Supabase log (includes client_name for filtering)
  logEvent(key, clientName, channel, payload);

  res.json({ ok: true, channel, listeners: connCount(key) });
}

app.post("/events", authMiddleware, publishHandler);
app.post("/event",  authMiddleware, publishHandler); // legacy alias

// ─── ESPN live scores (broadcast to "sports" channel for all connected keys) ──

const ESPN_ENDPOINTS = [
  { sport: "nfl",  url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard" },
  { sport: "nba",  url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" },
  { sport: "mlb",  url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard" },
  { sport: "nhl",  url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard" },
];

async function fetchESPNScores(sport, url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const json = await r.json();
    const games = (json.events || []).map((ev) => {
      const comp = ev.competitions?.[0];
      const teams = (comp?.competitors || []).map((c) => ({
        name: c.team?.abbreviation || c.team?.shortDisplayName || "",
        score: c.score || "0",
        home: c.homeAway === "home",
      }));
      return {
        id: ev.id,
        status: comp?.status?.type?.shortDetail || "",
        teams,
      };
    });
    return { sport, games, ts: Date.now() };
  } catch (_) {
    return null;
  }
}

async function tickAllScores() {
  if (!ESPN_ENABLED) return;
  if (clients.size === 0) return; // skip if nobody is listening

  for (const { sport, url } of ESPN_ENDPOINTS) {
    const payload = await fetchESPNScores(sport, url);
    if (!payload || payload.games.length === 0) continue;

    // Broadcast only to connected clients who have the "scores" feature enabled
    for (const [bridgeKey] of clients) {
      if (!scoresEnabledFor(bridgeKey)) continue;
      broadcast(bridgeKey, "sports", { type: "scores_update", ...payload });
    }
  }
}

if (ESPN_ENABLED) {
  refreshFeatureFlags();                          // load scores flags at startup
  setInterval(refreshFeatureFlags, FLAG_REFRESH_MS);
  setInterval(tickAllScores, ESPN_POLL_MS);
}

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[bridge] TSU Multi-Tenant Bridge listening on :${PORT}`);
  console.log(`[bridge] ESPN scores: ${ESPN_ENABLED ? "enabled" : "disabled"}`);
});
