# TSU Card Break Overlay Platform

Production overlay system for Trade Secrets Unlocked sports card break streamers.
Single-file HTML overlays served as OBS browser sources, connected to a shared
SSE bridge for real-time Whatnot sale automation.

---

## Live Infrastructure

| Service | URL |
|---|---|
| Shared SSE Bridge | `https://bridge.tradesecretsunlocked.com` |
| Bridge health check | `https://bridge.tradesecretsunlocked.com/health` |
| Per-key status | `https://bridge.tradesecretsunlocked.com/status?key={key}` |

---

## Repository Structure

```
overlays/
  {client-slug}/       ← production overlay (approved + deployed)
  _drafts/             ← overlays pending Mike's review
bridge/
  server.js            ← multi-tenant SSE bridge (deployed on Render)
  CLIENT-ONBOARDING.md ← step-by-step new client setup
  migration-keys.sql   ← all 46 client bridge keys for Supabase
  setup-bridge-keys.sql← Supabase table schema
extension-UPDATED-04-14-2026/
  content.js           ← Chrome extension (Whatnot sale detection)
  injected.js          ← page-context script
docs/
  WORKFLOW.md          ← full platform workflow: purchase → go live
STANDARDS.md           ← overlay development standards
```

---

## How It Works

Each client has:
- An overlay HTML file at `overlays/{slug}/index.html` — runs in OBS as a browser source
- A Chrome extension zip with their bridge key baked in — installed in their Whatnot browser
- A bridge key registered in Supabase (`bridge_keys` table)

When a client streams:
1. Their OBS overlay connects to `bridge.tradesecretsunlocked.com` via SSE using their key
2. Their Chrome extension detects sales on Whatnot and POSTs events to the bridge
3. The bridge routes events to their overlay only — complete isolation between clients
4. Sold tiles update in real time on stream

---

## Key Documents

- `docs/WORKFLOW.md` — full business workflow from purchase to go live
- `STANDARDS.md` — overlay code standards (all devs must read)
- `bridge/CLIENT-ONBOARDING.md` — how to set up a new client
- `bridge/README.md` — bridge deployment and API reference
