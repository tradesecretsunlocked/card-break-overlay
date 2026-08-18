import { log } from "./log.js";

/**
 * SSE hub. Isolation is BY BRIDGE KEY, exactly as on the main bridge. Channels are
 * only ever "main" (sales) and "sports" (scores). No new channel names, no templated
 * channel names, because a templated channel fails completely silently.
 */
const clients = new Map(); // bridgeKey -> Set<res>

export function addClient(bridgeKey, channel, req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.__channel = channel;
  if (!clients.has(bridgeKey)) clients.set(bridgeKey, new Set());
  clients.get(bridgeKey).add(res);

  res.write(`data: ${JSON.stringify({ type: "bridge_hello", platform: "tiktok", channel, ts: Date.now() })}\n\n`);

  // Render idles out a quiet connection. The overlay reconnects at about 2500ms on
  // error, but a heartbeat keeps a healthy stream from being torn down needlessly.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* the close handler will clean up */
    }
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.get(bridgeKey)?.delete(res);
    if (clients.get(bridgeKey)?.size === 0) clients.delete(bridgeKey);
  };
  req.on("close", cleanup);
  res.on("error", cleanup);

  log.info("sse client connected", { bridge_key: bridgeKey, channel, total: clientCount() });
}

export function broadcast(bridgeKey, payload, channel = "main") {
  const set = clients.get(bridgeKey);
  if (!set?.size) return 0;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  let sent = 0;
  for (const res of set) {
    if (res.__channel && res.__channel !== channel) continue;
    try {
      res.write(frame);
      sent++;
    } catch (e) {
      log.warn("sse write failed", { bridge_key: bridgeKey, error: e.message });
    }
  }
  return sent;
}

export function clientCount() {
  let n = 0;
  for (const set of clients.values()) n += set.size;
  return n;
}

export function connectedKeys() {
  return [...clients.keys()];
}
