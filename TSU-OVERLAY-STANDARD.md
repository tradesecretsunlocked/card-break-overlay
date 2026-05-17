# TSU Overlay Standard — Build & Deploy Reference
**Version:** 2.2 | **Updated:** 2026-05-16

This document is the single source of truth for every TSU overlay build, extension deploy, and Supabase key setup. When anything here conflicts with older notes or code comments, this document wins.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Extension (v2.2) Setup](#2-extension-v22-setup)
3. [Overlay Bridge Wiring](#3-overlay-bridge-wiring)
4. [Overlay Automation Requirements](#4-overlay-automation-requirements)
5. [Live Scores Setup](#5-live-scores-setup)
6. [Sold Panel — Correct Pattern](#6-sold-panel--correct-pattern)
7. [Supabase — New Client Key](#7-supabase--new-client-key)
8. [Deploy Checklist](#8-deploy-checklist)
9. [Validation Checklist](#9-validation-checklist)
10. [Known Bugs & Anti-Patterns](#10-known-bugs--anti-patterns)

---

## 1. Architecture Overview

```
Whatnot live page
   └── Chrome Extension (v2.2 content.js + injected.js)
           │  polls GraphQL every 3s, resolves team codes
           │  POSTs team_sold / team_unsold to bridge
           ▼
   bridge.tradesecretsunlocked.com   ← shared, always-on (Render)
           │  validates x-bridge-key against Supabase
           │  broadcasts events on client's SSE channel
           ▼
   Overlay (index.html in OBS browser source)
           │  connects SSE: /stream?channel=main
           │  marks teams sold, updates sold list, animates
           ▼
   Supabase DB   ← bridge_keys table (key validation only)
```

**Key facts:**
- One shared bridge for all clients — `https://bridge.tradesecretsunlocked.com`
- No per-client Render services. Do not create new Render instances.
- Clients are isolated by `bridgeKey` (validated by Supabase) and `channel`
- The overlay and extension never talk to each other directly — everything goes through the bridge

---

## 2. Extension (v2.2) Setup

### Files required (3 total)
| File | Source | Notes |
|---|---|---|
| `manifest.json` | Copy from any v2.2 client | Update nothing — it's identical for all clients |
| `content.js` | Copy from `218` extension, update DEFAULTS block | Only DEFAULTS change per client |
| `injected.js` | Copy verbatim from any v2.2 client | Never modify |

### Standard manifest.json
```json
{
  "manifest_version": 3,
  "name": "TSU Bridge (Whatnot)",
  "version": "1.0.0",
  "description": "Reads Whatnot livestream sales data and forwards to TSU bridge.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://www.whatnot.com/*",
    "https://*.whatnot.com/*",
    "https://bridge.tradesecretsunlocked.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://www.whatnot.com/*", "https://*.whatnot.com/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": ["injected.js"],
    "matches": ["https://www.whatnot.com/*", "https://*.whatnot.com/*"]
  }]
}
```

> ⚠️ `host_permissions` MUST include `bridge.tradesecretsunlocked.com/*`. Without it, Chrome MV3 silently blocks all POSTs to the bridge — no error, no 401, just silence.

### DEFAULTS block in content.js — the only thing that changes per client

```js
// LOCKED — same for every client. Do not change this per-client.
const BRIDGE_URL = "https://bridge.tradesecretsunlocked.com";

// CHANGE PER CLIENT — only these 3 fields differ between clients.
const DEFAULTS = {
  bridgeKey:    "CLIENT-UUID-HERE",   // from Supabase INSERT (see §7)
  sport:        "nfl",                // "nfl" | "nba" | "mlb" | "nil" (nil = multi-sport)
  overlayId:    "client-handle",      // must match overlay's BRIDGE_KEY constant context
  channel:      "main",
  pollMs:       3000,
  summaryEvery: 5
};
```

**Sport values:**
| Value | Use when |
|---|---|
| `"nfl"` | Client only breaks NFL |
| `"nba"` | Client only breaks NBA |
| `"mlb"` | Client only breaks MLB |
| `"nil"` | Client breaks multiple sports — extension infers sport from listing title |

### isBadTitle — must include the slot-index guard

```js
function isBadTitle(t) {
  const raw = String(t || "").trim();
  if (!raw) return true;
  const s = raw.toLowerCase();
  if (s === "sale" || s === "—") return true;
  if (/^#?\d+$/.test(raw)) return true;   // ← REQUIRED: rejects "#3", "#15" Whatnot slot subtitles
  const tail = stripPrefixTitle(raw);
  if (!tail || tail.toLowerCase() === "sale") return true;
  return false;
}
```

> **Why:** When `listing.title` is null on the first Whatnot GraphQL poll, the API returns `listing.subtitle` which Whatnot auto-fills with the slot index (`"#3"`, `"#15"`, etc.). Without this guard, the extension sends `code: ""` events which the overlay cannot resolve — teams get silently dropped or misfired.
>
> The guard does NOT set `seen` for bad titles, so the item retries on the next poll when the real title loads.

---

## 3. Overlay Bridge Wiring

### Correct pattern — hardcoded constants

```js
const BRIDGE_BASE = "https://bridge.tradesecretsunlocked.com";
const BRIDGE_KEY  = "CLIENT-UUID-HERE";   // same UUID as extension DEFAULTS.bridgeKey

function getBridgeBase(){
  return (new URLSearchParams(location.search).get("bridge") || BRIDGE_BASE).replace(/\/$/,"");
}
function getBridgeKey(){
  return new URLSearchParams(location.search).get("key") || BRIDGE_KEY;
}
function bridgeEnabled(){
  return !!(getBridgeBase() && getBridgeKey());
}
```

> ⚠️ Do NOT read `getBridgeBase()` from `localStorage` first. Old sessions may have a stale `tsu.bridgeUrl` pointing at a retired Render instance — that URL will silently win and the overlay will never connect.

### warmupPing — correct endpoint

```js
// CORRECT — POSTs to /events with type:"overlay_warmup"
function warmupPing(){
  fetch(`${getBridgeBase()}/events`, {
    method: "POST",
    headers: { "x-bridge-key": getBridgeKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "overlay_warmup", overlayId: "client-handle", channel: "main" })
  }).catch(() => {});
}
```

> ⚠️ Do NOT POST to `/warmup` — that endpoint does not exist on the bridge. Always use `/events`.

### SSE connection — key must be in query string

`EventSource` does not support custom request headers. The bridge key **cannot** be sent via `x-bridge-key` on an SSE connection — it must go in the URL as `&key=`.

```js
// ✅ CORRECT — key in query string
const url = `${getBridgeBase()}/stream?channel=${encodeURIComponent(channel)}&key=${encodeURIComponent(getBridgeKey())}`;
sse = new EventSource(url);

// ❌ WRONG — EventSource ignores headers; bridge returns 401 "Missing bridge key"
sse = new EventSource(`${getBridgeBase()}/stream?channel=main`);
// (then trying to set headers via fetch or XMLHttpRequest won't work either — EventSource only)
```

This applies to **both** SSE connections: `connectBridgeSSE` (channel=main) and `connectScoresSSE` (channel=sports).

```js
// REQUIRED: listen for named event types explicitly (SSE named events bypass onmessage)
["team_sold","team_unsold","buyer","reset","set_break","set_sport",
 "scores","stream_stats","whatnot_purchase","purchase"].forEach(t => {
  try { sse.addEventListener(t, ingest); } catch(_) {}
});
```

---

## 4. Overlay Automation Requirements

Every overlay MUST have these structures. Missing any one of them is a build failure.

### soldTeams Set
```js
const soldTeams = new Set();      // team codes currently sold
let soldTeamsList = [];           // [{code, buyer}] — ordered, for sold panel display
```

### lastCodeByListingKey Map
```js
const lastCodeByListingKey = new Map(); // saleId/id → last team code (handles respins)
```

**Why:** When a buyer wins a respin, Whatnot reuses the same `saleId`. The extension sends the new code, and the overlay must unsell the previous code before marking the new one sold. Without this map, both the old and new team show as sold.

### team_sold handler — correct reassignment logic

```js
if (data.type === "team_sold") {
  let code = getCodeFromPayload(data);
  if (!code) code = inferTeamCodeFromSaleTitle(data.title, currentBreakType);

  const listingKey = data.saleId || data.id || data.listingId || null;

  if (listingKey && code) {
    const prevCode = lastCodeByListingKey.get(listingKey);
    if (prevCode && prevCode !== code) {
      sseMarkUnsold(prevCode);    // auto-unsell previous assignment
    }
    lastCodeByListingKey.set(listingKey, code);
  }

  if (code) sseMarkSold(code, buyer);
  return;
}
```

### overlayId — must match extension DEFAULTS.overlayId

The `overlayId` in the overlay and the `overlayId` in the extension DEFAULTS must be identical strings. The bridge uses this to route warmup pings correctly.

---

## 5. Live Scores Setup

### Scores feature flag
```js
// Enabled by default. Disable via ?scores=0 in the OBS URL.
const ENABLE_SCORES = (getParam("scores") === null) ? true : (getParam("scores") === "1");
```

### Freshness guard — 20-minute window
```js
const SCORES_BY_SPORT  = { nba: "", nfl: "", mlb: "" };
const SCORES_UPDATED_AT = { nba: 0,  nfl: 0,  mlb: 0 };

function isFreshSportScore(sport){
  return (Date.now() - (SCORES_UPDATED_AT[sport] || 0)) < 1000 * 60 * 20;
}
```

Scores older than 20 minutes are silently dropped from the ticker.

### Separate SSE channel for scores
```js
function getScoresChannel(){ return "sports"; }

// Connect scores on its own SSE stream — separate from the main channel
connectScoresSSE({ onEvent: handleSSEEvent, onStatus: () => {} });
```

### Ticker interleave pattern — client text between each sport
```js
function buildTickerLine(){
  const client = getDefaultTickerText();  // client's custom ticker lines joined
  if (!ENABLE_SCORES) return client;
  const order = ["nba","mlb","nfl"];
  const parts = [];
  for (const s of order){
    const txt = (SCORES_BY_SPORT[s] || "").trim();
    if (txt && isFreshSportScore(s)){
      parts.push(client);
      parts.push(txt);
    }
  }
  return parts.length ? parts.join("   •   ") : client;
}
```

Output pattern: `[client] • [NBA] • [client] • [MLB] • [client] • [NFL]`

---

## 6. Sold Panel — Correct Pattern

### updateSoldList — incremental patch, never innerHTML wipe

```js
function updateSoldList(){
  const soldListDiv = document.getElementById("soldList");
  if (!soldListDiv) return;
  const currentBreak = breakTypes[currentBreakType];

  // Remove rows for teams no longer sold
  soldListDiv.querySelectorAll(".sold-row[data-code]").forEach(row => {
    if (!soldTeamsList.some(e => e.code === row.dataset.code)) row.remove();
  });

  // Add new rows / update existing without rebuild
  soldTeamsList.forEach(entry => {
    const team = currentBreak.teams.find(t => t.code === entry.code);
    if (!team) return;

    let row = soldListDiv.querySelector(`.sold-row[data-code="${entry.code}"]`);

    if (!row) {
      row = document.createElement("div");
      row.className = "sold-row";
      row.dataset.code = entry.code;

      if (team.image){
        const img = document.createElement("img");
        img.src = team.image;
        img.className = "sold-team-img";
        row.appendChild(img);
      }

      const name = document.createElement("span");
      name.className = "sold-team-name";
      name.textContent = team.name || team.code;
      row.appendChild(name);

      const input = document.createElement("input");
      input.className = "sold-buyer-input";
      input.type = "text";
      input.placeholder = "Buyer";
      input.value = entry.buyer || "";
      input.oninput = (e) => { entry.buyer = e.target.value || ""; };
      row.appendChild(input);

      soldListDiv.appendChild(row);
    } else {
      // Update buyer input value only if it's not currently focused (preserves typing)
      const input = row.querySelector(".sold-buyer-input");
      if (input && document.activeElement !== input) {
        input.value = entry.buyer || "";
      }
    }
  });
}
```

> ⚠️ **Never use `soldListDiv.innerHTML = ""`** in updateSoldList. Every call destroys active inputs, clears text being typed, and causes the visible "glitch/reset" the client sees.

---

## 7. Supabase — New Client Key

### Generate a UUID
Run in PowerShell:
```powershell
[System.Guid]::NewGuid().ToString()
```
Example output: `5d74ccce-d801-4064-8095-5428b6e7598e`

### Insert into Supabase SQL Editor
```sql
INSERT INTO bridge_keys (key, client_name, notes)
VALUES (
  'GENERATED-UUID-HERE',
  'Client Name',
  'client-handle overlay — brief description'
)
ON CONFLICT (key) DO NOTHING;
```

### Table schema reference
```sql
CREATE TABLE bridge_keys (
  key          TEXT        PRIMARY KEY,
  client_name  TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 8. Deploy Checklist

### New client deploy (in order)

- [ ] Generate UUID (`[System.Guid]::NewGuid().ToString()`)
- [ ] Run Supabase SQL INSERT with new key
- [ ] Copy `extension-UPDATED-04-14-2026` folder from template client
- [ ] Update `content.js` DEFAULTS: `bridgeKey`, `sport`, `overlayId`
- [ ] Confirm `manifest.json` has `bridge.tradesecretsunlocked.com/*` in `host_permissions`
- [ ] Confirm `manifest.json` has NO `*.onrender.com` entries
- [ ] Confirm `content.js` `isBadTitle` includes `/^#?\d+$/` guard
- [ ] Build overlay: `BRIDGE_BASE` and `BRIDGE_KEY` hardcoded as constants
- [ ] Confirm `getBridgeBase()` does NOT read from localStorage as primary source
- [ ] Confirm `warmupPing` / `bridgeWarmup` POSTs to `/events` (not `/warmup`)
- [ ] Confirm `overlayId` in overlay matches `overlayId` in extension DEFAULTS
- [ ] Confirm `soldTeams Set` is present
- [ ] Confirm `lastCodeByListingKey Map` is present
- [ ] Confirm `updateSoldList()` does NOT use `innerHTML = ""`
- [ ] Stage overlay to `_drafts/{client}/index.html` for Mike review
- [ ] Mike promotes `_drafts/` → `overlays/{client}/index.html`
- [ ] Client installs: Remove old extension → Chrome Extensions → Load unpacked → select new folder → enable toggle
- [ ] Load overlay in OBS browser source
- [ ] No server redeploy needed — bridge is always-on

### Extension reinstall steps (client-facing)
1. Open Chrome → `chrome://extensions`
2. Find old TSU Bridge extension → click **Remove**
3. Click **Load unpacked**
4. Select the new `extension-UPDATED-04-14-2026` folder
5. Toggle the extension **on**
6. Navigate to the Whatnot live page and confirm console shows `[TSU] Bridge: https://bridge.tradesecretsunlocked.com`

---

## 9. Validation Checklist

Run these checks on every overlay before marking it ready for review.

| Check | What to verify |
|---|---|
| `soldTeams Set` | `const soldTeams = new Set()` present in STATE section |
| `soldTeamsList` array | `let soldTeamsList = []` present |
| `lastCodeByListingKey Map` | `const lastCodeByListingKey = new Map()` present |
| Bridge constants | `const BRIDGE_BASE` and `const BRIDGE_KEY` hardcoded, not from localStorage |
| `getBridgeBase()` | Returns URL param OR hardcoded constant — no localStorage lookup |
| `getBridgeKey()` | Returns URL param OR hardcoded constant — no localStorage lookup |
| `bridgeEnabled()` | Checks both `getBridgeBase()` AND `getBridgeKey()` |
| `warmupPing` endpoint | POSTs to `/events`, not `/warmup` |
| SSE key in URL | Both `connectBridgeSSE` and `connectScoresSSE` URLs include `&key=${encodeURIComponent(getBridgeKey())}` — EventSource cannot send headers |
| SSE named listeners | All types listed including `team_sold`, `team_unsold`, `buyer`, `scores` |
| `team_sold` handler | Includes `lastCodeByListingKey` reassignment check |
| `overlayId` match | overlay's overlayId string === extension DEFAULTS.overlayId |
| No `scoresChannel` (deprecated) | Search for `scoresChannel` — must return 0 results |
| `ENABLE_SCORES` | Present, reads from `?scores=` param |
| `isFreshSportScore` | 20-minute freshness window |
| `updateSoldList` | Does NOT use `innerHTML = ""` — uses incremental patch |
| No stale Render URLs | Search for `onrender.com` in overlay — must return 0 results |
| manifest `host_permissions` | Includes `bridge.tradesecretsunlocked.com/*`, no `onrender.com` |
| `isBadTitle` in extension | Includes `/^#?\d+$/` guard |

---

## 10. Known Bugs & Anti-Patterns

| Bug | Symptom | Root cause | Fix |
|---|---|---|---|
| Bridge POSTs silently fail | Teams hit Whatnot but never appear on overlay | `bridge.tradesecretsunlocked.com` missing from `manifest.json` `host_permissions` | Add bridge domain to host_permissions |
| Stale Render URL overrides bridge | Overlay connects to wrong bridge, gets 404s | `getBridgeBase()` reads localStorage first; old session has retired Render URL | Hardcode `BRIDGE_BASE` constant, bypass localStorage |
| `#3` slot titles fire `code:""` | Wrong team marked first, nothing works after | Whatnot returns `listing.title = null` on first poll, falls back to slot subtitle `"#3"` | Add `/^#?\d+$/` guard to `isBadTitle` |
| warmupPing gets 404 | Console shows bridge POST errors on load | POSTing to `/warmup` which doesn't exist | Change to POST `/events` with `type:"overlay_warmup"` |
| overlayId mismatch | Bridge warmup routing broken | Extension and overlay have different overlayId strings | Set both to the same value |
| Sold panel resets / glitches | Panel flashes, buyer inputs clear while typing | `updateSoldList()` uses `innerHTML = ""` — full DOM rebuild on every event | Patch incrementally: add/remove/update rows, skip focused inputs |
| Teams past slot 24 never sold | First 24 slots work, rest silently dropped | Extension used `after: null` on every page (only fetched page 1) | v2.2 pagination: loop all pages up to `MAX_PAGES = 12` |
| Lost events on network blip | Break has gaps despite sales showing in Whatnot | Old extension set `seen` before confirming bridge POST | v2.2 fix: only set `seen` after successful `sendEvent()` |
| Duplicate team_sold on respin | Both old and new team show sold | No reassignment tracking | `lastCodeByListingKey` map — unsell prev code when same saleId returns different code |
| Extension silently 401s all session | No sales ever appear | `bridgeKey` not set in DEFAULTS (left as placeholder) | Extension now fails fast with console error if bridgeKey is missing |
| SSE 401 "Missing bridge key" | All `/stream` connections return 401, overlay never receives events | `EventSource` doesn't support headers; `x-bridge-key` header is ignored on SSE connections | Append `&key=${encodeURIComponent(getBridgeKey())}` to SSE URLs — applies to both main and sports channels |

---

## Quick Reference — Per-Client Diff

When building a new client overlay, the ONLY things that change from the template are:

**Extension `content.js` DEFAULTS:**
```
bridgeKey  → new UUID from Supabase
sport      → "nfl" | "nba" | "mlb" | "nil"
overlayId  → "client-handle"
```

**Overlay `index.html`:**
```
BRIDGE_KEY → same UUID as extension
overlayId  → same string as extension DEFAULTS.overlayId
Colors     → client primary/secondary
Logo       → client logo path
Ticker     → client default ticker text
```

Everything else — SSE logic, sold list, scores feed, bridge functions — is identical across all clients. Do not modify automation code during a clone build.
