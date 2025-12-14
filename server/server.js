import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const BRIDGE_KEY = process.env.BRIDGE_KEY || "";

function assertBridgeKey(req, res, next) {
  const incoming = req.get("x-bridge-key") || "";

  // 🔍 LOG EVERY REQUEST (even failures)
  console.log("[AUTH CHECK]", {
    method: req.method,
    path: req.path,
    hasServerKey: !!BRIDGE_KEY,
    incomingKeyPresent: !!incoming,
    incomingKeyLength: incoming.length,
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
    userAgent: req.headers["user-agent"]
  });

  // Allow all if no server key is set
  if (!BRIDGE_KEY) {
    console.log("[AUTH] No BRIDGE_KEY set on server — OPEN MODE");
    return next();
  }

  // Allow valid key
  if (incoming && incoming === BRIDGE_KEY) {
    console.log("[AUTH] ✅ Valid bridge key");
    return next();
  }

  console.warn("[AUTH] ⛔ Invalid bridge key");
  return res.status(401).json({ error: "invalid bridge key" });
}

function assertStreamKey(req, res, next) {
  if (!BRIDGE_KEY) {
    console.log("[SSE AUTH] No BRIDGE_KEY set — OPEN MODE");
    return next();
  }

  const key = req.query.key || "";

  console.log("[SSE AUTH CHECK]", {
    path: req.path,
    keyPresent: !!key,
    keyLength: key.length,
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
  });

  if (key === BRIDGE_KEY) {
    console.log("[SSE AUTH] ✅ Valid SSE key");
    return next();
  }

  console.warn("[SSE AUTH] ⛔ Invalid SSE key");
  return res.status(401).end("invalid bridge key");
}



/**
 * SSE client pool
 */
const clients = new Set();

app.get("/stream", assertStreamKey, (req, res) => {

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clients.add(res);
  req.on("close", () => clients.delete(res));
});

/**
 * Broadcast event payload to connected overlays
 * Expected body:
 * { breakId, breakType, teamCode, buyerName, ts, type? }
 */
app.post("/events", assertBridgeKey, (req, res) => {
  const event = req.body || {};
    console.log("POST /events", {
    breakId: event.breakId,
    breakType: event.breakType,
    teamCode: event.teamCode,
    division: event.division,
    buyerName: event.buyerName,
    ts: event.ts
  });

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(payload);
  res.json({ ok: true });
});

/**
 * Optional reset endpoint (lets you fire a reset from anywhere)
 * Body: { breakId, breakType, type: "reset" }
 */
app.post("/reset", assertBridgeKey, (req, res) => {
  const event = { ...req.body, type: "reset", ts: Date.now() };
  console.log("POST /reset", { breakId: event.breakId, breakType: event.breakType });
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(payload);
  res.json({ ok: true });
});

// Render ALWAYS provides process.env.PORT. You MUST use it.
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SSE server listening on ${PORT}`);
});

