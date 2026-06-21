# TSU Overlay Standard — Build & Deploy Reference
**Version:** 2.3 | **Updated:** 2026-05-16

This document is the single source of truth for every TSU overlay build, extension deploy, and Supabase key setup. When anything here conflicts with older notes or code comments, this document wins.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Extension (v2.2) Setup](#2-extension-v22-setup)
3. [Overlay Bridge Wiring](#3-overlay-bridge-wiring)
4. [Overlay Automation Requirements](#4-overlay-automation-requirements)
5. [Live Scores Setup](#5-live-scores-setup)
6. [Per-Client Services (Supabase)](#6-per-client-services-supabase)
7. [Sold Panel — Correct Pattern](#7-sold-panel--correct-pattern)
8. [Supabase — New Client Key](#8-supabase--new-client-key)
9. [Deploy Checklist](#9-deploy-checklist)
10. [Validation Checklist](#10-validation-checklist)
11. [Known Bugs & Anti-Patterns](#11-known-bugs--anti-patterns)

---

## 1. Architecture Overview

```
Whatnot live page
   └── Chrome Extension (v2.2 content.js + injected.js)
           │  polls GraphQL every 3s, resolves team codes
           │  POSTs team_sold / team_unsold to bridge
           ▼
   bridge.tradesecretsunlocked.com   ← shared, always-on (Render)
           │  validates x-bridge-key against Supabase bridge_keys
           │  broadcasts events on client's SSE channel (channel=main)
           ▼
   Overlay (index.html in OBS browser source)
           │  connects SSE: /stream?channel=main&key=...
           │  connects SSE: /stream?channel=sports-{namespace}&key=...
           │  marks teams sold, updates sold list, animates
           ▼
   Supabase DB   ← bridge_keys + client_services tables

   tsu-score-bridge (separate Render service)
           │  polls ESPN every 15s — NBA, NFL, MLB
           │  reads client_services table every 5 min
           │  POSTs scores to bridge /events per enabled client
           ▼
   bridge.tradesecretsunlocked.com
           │  broadcasts on channel=sports-{namespace}
           ▼
   Overlay connectScoresSSE → ticker marquee
```

**Key facts:**
- One shared bridge for all clients — `https://bridge.tradesecretsunlocked.com`
- No per-client Render services. Do not create new Render instances.
- Clients are isolated by `bridgeKey` (validated against `bridge_keys`) and `channel`
- Scores are opt-in per client via the `client_services` Supabase table — toggling a row enables/disables scores without any code change or redeploy
- The overlay and extension never talk to each other directly — everything goes through the bridge
- Future services (stream stats widgets, promo feeds, etc.) follow the same `client_services` toggle pattern

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

### How scores flow (end to end)

```
ESPN public API (NBA / NFL / MLB)
   ▼  polled every 15s by tsu-score-bridge
tsu-score-bridge
   │  reads client_services table → gets enabled namespaces
   │  POSTs { type:"scores", channel:"sports-{namespace}", sport:"nba", games:[...] }
   ▼
bridge.tradesecretsunlocked.com  →  broadcasts on channel sports-{namespace}
   ▼
Overlay connectScoresSSE (channel = sports-{SCORES_NAMESPACE})
   ▼  normalizeScorePayloadToText
SCORES_BY_SPORT["nba"] = "NBA: LAL 112-108 BOS (Final)"
   ▼  buildTickerLine
ticker: [client text] • [NBA] • [client text] • [MLB] • ...
```

Scores only reach a client's overlay if that client has `service='scores'` enabled in Supabase. Toggling the row is the only control needed — no code changes, no redeploy.

---

### Overlay constants — one per client

```js
const BRIDGE_BASE      = "https://bridge.tradesecretsunlocked.com";
const BRIDGE_KEY       = "CLIENT-UUID-HERE";
const SCORES_NAMESPACE = "client-handle";  // ← slug that matches bridge_keys.namespace in Supabase
```

`SCORES_NAMESPACE` is the only scores-specific constant that changes per client. It must match the `namespace` value set in the `bridge_keys` table for this client.

### Scores feature flag
```js
// Enabled by default in overlay. Disable overlay-side via ?scores=0 in the OBS URL.
// Real per-client control is via Supabase client_services — see §6.
const ENABLE_SCORES = (getParam("scores") === null) ? true : (getParam("scores") === "1");
```

### Per-client SSE channel
```js
// ✅ CORRECT — per-client channel; only receives scores if enabled in Supabase
function getScoresChannel(){
  return `sports-${SCORES_NAMESPACE}`;
}

// ❌ OLD / WRONG — global channel; all overlays receive all scores with no per-client control
function getScoresChannel(){ return "sports"; }
```

### Freshness guard — 20-minute window
```js
const SCORES_BY_SPORT   = { nba: "", nfl: "", mlb: "" };
const SCORES_UPDATED_AT = { nba: 0,  nfl: 0,  mlb: 0 };

function isFreshSportScore(sport){
  return (Date.now() - (SCORES_UPDATED_AT[sport] || 0)) < 1000 * 60 * 20;
}
```

Scores older than 20 minutes are silently dropped from the ticker. This prevents stale game data from lingering when no games are in progress.

### Ticker interleave pattern — client text between each sport
```js
function buildTickerLine(){
  const client = getDefaultTickerText();
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

### Score payload format accepted by the overlay
```js
// Format 1 — pre-formatted text string (simplest)
{ type: "scores", channel: "sports-jp2-cards", sport: "nba", text: "NBA: LAL 112-108 BOS (Final)" }

// Format 2 — games array (what tsu-score-bridge sends)
{ type: "scores", channel: "sports-jp2-cards", sport: "nba",
  games: [{ away:"LAL", awayScore:112, home:"BOS", homeScore:108, status:"Final" }, ...] }

// Format 3 — lines array
{ type: "scores", channel: "sports-jp2-cards", sport: "nba", lines: ["LAL 112-108 BOS", ...] }
```

The overlay's `normalizeScorePayloadToText()` handles all three formats.

---

## 6. Per-Client Services (Supabase)

All optional features (live scores, and future services) are toggled per client via the `client_services` table. No code changes or redeploys are needed to enable or disable a service for a client.

### Supabase table schema

```sql
-- Run once to set up
ALTER TABLE bridge_keys ADD COLUMN IF NOT EXISTS namespace TEXT;

CREATE TABLE IF NOT EXISTS client_services (
  key        TEXT        NOT NULL REFERENCES bridge_keys(key) ON DELETE CASCADE,
  service    TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, service)
);
```

**`bridge_keys.namespace`** — URL-safe slug for this client (e.g. `jp2-cards`, `apex-card-company`). Used to name the client's per-service SSE channels. Set once when onboarding a client.

**`client_services`** — one row per client per feature. The score-bridge reads this table every 5 minutes. Toggle `enabled` to turn a service on or off.

### Available services

| `service` value | What it controls |
|---|---|
| `scores` | Live NBA/NFL/MLB scores in the ticker via tsu-score-bridge |
| *(future)* `stream_stats` | Top buyer / last sale widget feed |
| *(future)* `promo_feed` | Scheduled promo content pushed to overlay |

### New client onboarding — Supabase SQL

```sql
-- 1. Insert bridge key with namespace
INSERT INTO bridge_keys (key, client_name, namespace, notes)
VALUES (
  'GENERATED-UUID-HERE',
  'Client Name',
  'client-handle',          -- slug used for SSE channel names, e.g. "jp2-cards"
  'client-handle overlay'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Enable desired services
INSERT INTO client_services (key, service, enabled) VALUES
  ('GENERATED-UUID-HERE', 'scores', true)
ON CONFLICT (key, service) DO UPDATE SET enabled = true, updated_at = now();
```

### Toggling a service on/off

```sql
-- Disable scores for a client (takes effect within 5 minutes — no redeploy)
UPDATE client_services
SET enabled = false, updated_at = now()
WHERE key = 'CLIENT-UUID-HERE' AND service = 'scores';

-- Re-enable
UPDATE client_services
SET enabled = true, updated_at = now()
WHERE key = 'CLIENT-UUID-HERE' AND service = 'scores';
```

### tsu-score-bridge — required Render env vars

The score-bridge must have these set in the Render dashboard for the `tsu-scores-bridge` service:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://your-project.supabase.co` |
| `SUPABASE_KEY` | Service role key (not anon — needs table read access) |
| `BRIDGE_KEY` | Any valid key from `bridge_keys` (used to authenticate score POSTs) |

After adding env vars, trigger a manual redeploy on Render. The `/status` endpoint on the score-bridge returns which clients are currently enabled.

---

## 7. Sold Panel — Correct Pattern

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

## 8. Supabase — New Client Key

### Generate a UUID
Run in PowerShell:
```powershell
[System.Guid]::NewGuid().ToString()
```
Example output: `5d74ccce-d801-4064-8095-5428b6e7598e`

### Full new-client SQL (run in Supabase SQL Editor)
```sql
-- Step 1: Insert bridge key
INSERT INTO bridge_keys (key, client_name, namespace, notes)
VALUES (
  'GENERATED-UUID-HERE',
  'Client Name',
  'client-handle',     -- URL-safe slug, e.g. "jp2-cards" or "apex-card-company"
  'client-handle overlay — brief description'
)
ON CONFLICT (key) DO NOTHING;

-- Step 2: Enable services (add one row per service you want active)
INSERT INTO client_services (key, service, enabled) VALUES
  ('GENERATED-UUID-HERE', 'scores', true)
ON CONFLICT (key, service) DO UPDATE SET enabled = true, updated_at = now();
```

### bridge_keys table schema
```sql
CREATE TABLE bridge_keys (
  key          TEXT        PRIMARY KEY,
  client_name  TEXT        NOT NULL,
  namespace    TEXT,                          -- slug for per-client SSE channels
  active       BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### client_services table schema
```sql
CREATE TABLE client_services (
  key        TEXT        NOT NULL REFERENCES bridge_keys(key) ON DELETE CASCADE,
  service    TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, service)
);
```

> See §6 for full service toggle reference and tsu-score-bridge env var setup.

---

## 9. Deploy Checklist

### New client deploy (in order)

**Supabase**
- [ ] Generate UUID (`[System.Guid]::NewGuid().ToString()`)
- [ ] Run Supabase SQL — INSERT into `bridge_keys` with `key`, `client_name`, `namespace`
- [ ] Run Supabase SQL — INSERT into `client_services` for each service to enable (e.g. `scores`)

**Extension**
- [ ] Copy `extension-UPDATED-04-14-2026` folder from template client
- [ ] Update `content.js` DEFAULTS: `bridgeKey`, `sport`, `overlayId`
- [ ] Confirm `manifest.json` has `bridge.tradesecretsunlocked.com/*` in `host_permissions`
- [ ] Confirm `manifest.json` has NO `*.onrender.com` entries
- [ ] Confirm `content.js` `isBadTitle` includes `/^#?\d+$/` guard

**Overlay**
- [ ] Set `BRIDGE_BASE`, `BRIDGE_KEY`, and `SCORES_NAMESPACE` as hardcoded constants
- [ ] `SCORES_NAMESPACE` matches `namespace` set in Supabase `bridge_keys`
- [ ] `getScoresChannel()` returns `` `sports-${SCORES_NAMESPACE}` `` (not `"sports"`)
- [ ] Confirm `getBridgeBase()` does NOT read from localStorage as primary source
- [ ] Confirm `warmupPing` / `bridgeWarmup` POSTs to `/events` (not `/warmup`)
- [ ] Confirm `overlayId` in overlay matches `overlayId` in extension DEFAULTS
- [ ] Confirm `soldTeams Set` is present
- [ ] Confirm `lastCodeByListingKey Map` is present
- [ ] Confirm `updateSoldList()` does NOT use `innerHTML = ""`
- [ ] Both SSE URLs include `&key=${encodeURIComponent(getBridgeKey())}`
- [ ] Stage overlay to `_drafts/{client}/index.html` for Mike review
- [ ] Mike promotes `_drafts/` → `overlays/{client}/index.html`

**Live**
- [ ] Client installs: Remove old extension → Chrome Extensions → Load unpacked → select new folder → enable toggle
- [ ] Load overlay in OBS browser source
- [ ] Confirm SSE connected (no 401s in DevTools Network tab)
- [ ] If scores enabled: verify ticker shows scores within ~15s of score-bridge tick
- [ ] No server redeploy needed — bridge and score-bridge are always-on

### Extension reinstall steps (client-facing)
1. Open Chrome → `chrome://extensions`
2. Find old TSU Bridge extension → click **Remove**
3. Click **Load unpacked**
4. Select the new `extension-UPDATED-04-14-2026` folder
5. Toggle the extension **on**
6. Navigate to the Whatnot live page and confirm console shows `[TSU] Bridge: https://bridge.tradesecretsunlocked.com`

---

## 10. Validation Checklist

Run these checks on every overlay before marking it ready for review.

| Check | What to verify |
|---|---|
| `soldTeams Set` | `const soldTeams = new Set()` present in STATE section |
| `soldTeamsList` array | `let soldTeamsList = []` present |
| `lastCodeByListingKey Map` | `const lastCodeByListingKey = new Map()` present |
| Bridge constants | `const BRIDGE_BASE`, `const BRIDGE_KEY`, `const SCORES_NAMESPACE` all hardcoded |
| `SCORES_NAMESPACE` | Matches `namespace` value in Supabase `bridge_keys` for this client |
| `getBridgeBase()` | Returns URL param OR hardcoded constant — no localStorage lookup |
| `getBridgeKey()` | Returns URL param OR hardcoded constant — no localStorage lookup |
| `bridgeEnabled()` | Checks both `getBridgeBase()` AND `getBridgeKey()` |
| `getScoresChannel()` | Returns `` `sports-${SCORES_NAMESPACE}` `` — NOT the bare string `"sports"` |
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
| Supabase `client_services` | Row exists for this client's key + any enabled services |

---

## 11. Known Bugs & Anti-Patterns

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
| Scores not showing (no 401) | SSE connects but ticker never shows scores | Client not added to `client_services` table, or `tsu-score-bridge` not reading Supabase | Insert row into `client_services` with `service='scores'`; confirm score-bridge env vars set; check `/status` endpoint |
| All clients get/lose scores at once | Scores toggle affects every overlay | Using global `channel="sports"` in `getScoresChannel()` instead of per-client channel | Set `SCORES_NAMESPACE` constant and return `` `sports-${SCORES_NAMESPACE}` `` from `getScoresChannel()` |
| Another stream's sales bleed onto the board | Tiles get marked/unmarked by a different client's events | Bridge read from `localStorage` as primary **and/or** SSE subscribed without `&key=` → overlay joins the wrong/shared scope | Hardcode `BRIDGE_URL` + `BRIDGE_KEY`; always append `&key=` to every SSE URL (main + scores). Never localStorage-primary. (SSC + SMS-source class — `overlays/sms` patched 2026-06-20) |

---

## Quick Reference — Per-Client Diff

When building a new client overlay, the ONLY things that change from the template are:

**Supabase (one-time setup):**
```
bridge_keys.namespace → "client-handle"  (slug, e.g. "jp2-cards")
client_services row   → (key, 'scores', true)  — if scores enabled
```

**Extension `content.js` DEFAULTS:**
```
bridgeKey  → new UUID from Supabase
sport      → "nfl" | "nba" | "mlb" | "nil"
overlayId  → "client-handle"
```

**Overlay `index.html` constants:**
```
BRIDGE_KEY       → same UUID as extension
SCORES_NAMESPACE → same slug as bridge_keys.namespace  (e.g. "jp2-cards")
overlayId        → same string as extension DEFAULTS.overlayId
Colors           → client primary/secondary
Logo             → client logo path
Ticker           → client default ticker text
```

Everything else — SSE logic, sold list, scores feed, bridge functions — is identical across all clients. Do not modify automation code during a clone build.
