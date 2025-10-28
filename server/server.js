import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * SSE client pool
 */
const clients = new Set();

app.get("/stream", (req, res) => {
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
app.post("/events", (req, res) => {
  const event = req.body || {};
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(payload);
  res.json({ ok: true });
});

/**
 * Optional reset endpoint (lets you fire a reset from anywhere)
 * Body: { breakId, breakType, type: "reset" }
 */
app.post("/reset", (req, res) => {
  const event = { ...req.body, type: "reset", ts: Date.now() };
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(payload);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SSE server on", PORT));
