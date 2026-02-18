import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config(); // harmless on Render (no .env), useful locally

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 3000;
const BRIDGE_KEY = (process.env.BRIDGE_KEY || "").trim();

function requireKey(req, res) {
  // If no key is configured on the server, allow everything (open mode)
  if (!BRIDGE_KEY) return true;

  // Accept from query OR headers
  const qk = String(req.query.key || "").trim();
const hk =
  String(req.header("x-api-key") || "").trim() ||
  String(req.header("x-bridge-key") || "").trim() ||
  String(req.header("authorization") || "").replace(/^Bearer\s+/i, "").trim();


  const provided = qk || hk;

  if (!provided || provided !== BRIDGE_KEY) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

// Track SSE clients by channel
const channels = new Map(); // channel -> Set<res>

function getChannelSet(name) {
  const ch = (name || "main").toLowerCase();
  if (!channels.has(ch)) channels.set(ch, new Set());
  return channels.get(ch);
}
function normalizeSport(s) {
  const v = String(s || "").toLowerCase().trim();
  return ["nfl", "nba", "mlb", "nil"].includes(v) ? v : "";
}

// NFL teams include 2-letter codes; NBA/MLB are 3 letters.
// This helps avoid wrongly treating "IN" or "NO" as NBA/MLB codes.
function inferSportFromCode(code) {
  const c = String(code || "").toUpperCase().trim();
  if (!c) return "";
  if (c.length === 2) return "nfl";
  if (c.length === 3) return ""; // could be any; don't decide from length alone
  return "";
}

function inferSportFromTitle(title) {
  const t = String(title || "").toLowerCase();
  if (!t) return "";
  if (t.includes("football") || t.includes("nfl")) return "nfl";
  if (t.includes("basketball") || t.includes("nba")) return "nba";
  if (t.includes("baseball") || t.includes("mlb")) return "mlb";
  return "";
}

function extractCodeFromTitle(title) {
  const raw = String(title || "");
  // IMPORTANT: avoid grabbing "IN" "NO" etc as codes unless it's obviously a code token.
  const m = raw.match(/\b([A-Z]{2,4})\b/);
  return m?.[1] ? m[1] : "";
}


function broadcast(payload, channel = "main") {
  const type = String(payload?.type || "message");
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  const set = getChannelSet(channel);

  console.log("[TSU Bridge] broadcast -> channel:", channel, "clients:", set.size, "payload.type:", type);

  for (const res of set) {
    try { res.write(msg); } catch (_) { set.delete(res); }
  }
}




// ===== ESPN scoreboards (NBA/NFL/MLB) -> SAME SSE channel "sports" =====
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

async function fetchESPNScoreboard({ sport, url }) {
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

  // If ESPN returns no events, make it obvious it's not an error.
  if (!games.length) {
    return [{
      away: "—", awayScore: 0,
      home: "—", homeScore: 0,
      status: "No Games Found",
    }];
  }

  return games.slice(0, 4);
}

async function tickAllScores() {
  const date = yyyymmddChicago();

  const feeds = [
    {
      sport: "nba",
      url: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`,
    },
    {
      sport: "nfl",
      url: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date}`,
    },
    {
      sport: "mlb",
      url: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${date}`,
    },
  ];

  for (const f of feeds) {
    try {
      const games = await fetchESPNScoreboard(f);
      broadcast({ type: "scores", sport: f.sport, games, ts: Date.now() }, "sports");
    } catch (_) {
      broadcast({
        type: "scores",
        sport: f.sport,
        games: [{
          away: "—", awayScore: 0,
          home: "—", homeScore: 0,
          status: "No Games Found",
        }],
        ts: Date.now(),
      }, "sports");
    }
  }
}



// Health check
app.get("/", (req, res) => res.send("TSU Bridge OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// SSE stream (primary)
// SSE stream (primary)
function sseHandler(req, res) {
  // READ: open (no key required)
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
    try { res.write(`: ping ${Date.now()}\n\n`); }
    catch (_) { clearInterval(ping); set.delete(res); }
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

function inferSportFromPayload(p){
  const s = String(p?.sport || "").toLowerCase();
  if (["nfl","nba","mlb"].includes(s)) return s;

  const code = String(p?.code || "").toUpperCase();
  const title = String(p?.title || "").toLowerCase();

  // super simple heuristics (expand if needed)
  if (title.includes("nfl") || title.includes("football")) return "nfl";
  if (title.includes("mlb") || title.includes("baseball")) return "mlb";
  if (title.includes("nba") || title.includes("basketball")) return "nba";

  // if you want: infer by code sets (optional)
  return "";
}




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

// Poll NBA/NFL/MLB scores every 15s
setInterval(tickAllScores, 15000);
tickAllScores();


