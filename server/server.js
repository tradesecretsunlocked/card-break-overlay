import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config(); // harmless on Render (no .env), useful locally

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 3000;
const BRIDGE_KEY = (process.env.BRIDGE_KEY || "").trim();


// Track SSE clients by channel
const channels = new Map(); // channel -> Set<res>

function getChannelSet(name) {
  const ch = (name || "main").toLowerCase();
  if (!channels.has(ch)) channels.set(ch, new Set());
  return channels.get(ch);
}


function broadcast(payload, channel = "main") {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  const set = getChannelSet(channel);

  console.log(
    "[TSU Bridge] broadcast -> channel:",
    channel,
    "clients:",
    set.size,
    "payload.type:",
    payload?.type
  );

  for (const res of set) {
    try {
      res.write(msg);
    } catch (_) {
      set.delete(res);
    }
  }
}



// ===== ESPN NBA scoreboard (adds LIVE SCORES to same SSE stream) =====
function yyyymmddChicago(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return `${y}${m}${day}`;
}

async function fetchNBAScores() {
  const date = yyyymmddChicago();
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`;

  const r = await fetch(url, { headers: { "User-Agent": "tsu-bridge" } });
  if (!r.ok) throw new Error(`ESPN fetch failed: ${r.status}`);

  const data = await r.json();
  const events = Array.isArray(data?.events) ? data.events : [];

  const games = events.map(ev => {
    const comp = ev?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find(c => c.homeAway === "home");
    const away = competitors.find(c => c.homeAway === "away");

    const homeAbbr = home?.team?.abbreviation || home?.team?.shortDisplayName || "HOME";
    const awayAbbr = away?.team?.abbreviation || away?.team?.shortDisplayName || "AWAY";

    const homeScore = Number(home?.score ?? 0);
    const awayScore = Number(away?.score ?? 0);

    const status =
      comp?.status?.type?.shortDetail ||
      comp?.status?.type?.detail ||
      ev?.status?.type?.shortDetail ||
      "—";

    return { home: homeAbbr, homeScore, away: awayAbbr, awayScore, status };
  });

  return games.slice(0, 4);
}

async function tickScores() {
  try {
    const games = await fetchNBAScores();
    broadcast({ type: "scores", games, ts: Date.now() }, "sports");

  } catch (_) {
    broadcast({
      type: "scores",
      games: [{ away: "—", awayScore: 0, home: "—", homeScore: 0, status: "No feed" }],
      ts: Date.now() ,
    }, "sports");
  }
}


function requireKey(req, res) {
  // If no BRIDGE_KEY is configured, run “open” (useful for dev).
  if (!BRIDGE_KEY) return true;

  const got = (req.header("x-bridge-key") || "").trim();
  if (!got || got !== BRIDGE_KEY) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

// Health check
app.get("/", (req, res) => res.send("TSU Bridge OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// SSE stream (primary)
function sseHandler(req, res) {
  const channel = String(req.query.channel || "main").toLowerCase();
  const set = getChannelSet(channel);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.write(`data: ${JSON.stringify({ type: "hello", channel, ts: Date.now() })}\n\n`);

  set.add(res);

  const ping = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch (_) {
      clearInterval(ping);
      set.delete(res);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    set.delete(res);
  });
}


app.get("/events", sseHandler);
// Alias so your overlay can keep using /stream if you want
app.get("/stream", sseHandler);

// Writer (primary)
function postEvent(req, res) {
  if (!requireKey(req, res)) return;

  const body = req.body || {};
  const payload = {
    ...body,
    ts: typeof body.ts === "number" ? body.ts : Date.now(),
  };

  const channel =
    String(body.channel || req.header("x-channel") || "main").toLowerCase();

  console.log("[TSU Bridge] event in:", payload, "channel:", channel);

  broadcast(payload, channel);
  res.json({ ok: true });
}


app.post("/events", postEvent);
// Alias so older extensions that post to /event still work
app.post("/event", postEvent);

// Convenience reset route (optional)
app.post("/reset", (req, res) => {
  if (!requireKey(req, res)) return;
  for (const ch of channels.keys()) broadcast({ type: "reset", ts: Date.now() }, ch);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[TSU Bridge] listening on :${PORT}`);
  console.log(`[TSU Bridge] BRIDGE_KEY set: ${BRIDGE_KEY ? "yes" : "no (open mode)"}`);
});

// Poll NBA scores every 15s
setInterval(tickScores, 15000);
tickScores();

