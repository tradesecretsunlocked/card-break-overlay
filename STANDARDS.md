# Card Break Overlay — Development Standards

This document defines the standard patterns, naming conventions, and required functions for all overlays in this repo. New overlays should follow these standards; existing overlays should be migrated toward them over time.

---

## 1. Directory Structure

```
overlays/
  {client-slug}/
    index.html          ← single self-contained file (HTML + CSS + JS)
    {client}-logo.png   ← optional, referenced as ./logo.png or inline
images/
  nfl/{team}.png
  nba/{team}.png
  mlb/{team}.png
  logos/{brand}-logo.png
```

- One `index.html` per client. All CSS and JS lives inside it unless the client has a specific multi-file need.
- Image paths use `../../images/{sport}/{team}.png` from the overlay file.
- Logo paths use `../../images/logos/{slug}-logo.png`.
- New builds land in `overlays/_drafts/{client-slug}/` for review, then move to `overlays/{client-slug}/` when approved.

---

## 2. Base Templates

There are five named templates. Every overlay is built from one of these. The agent selects the template from the Build Queue `Template` field. Each template defines a different **layout structure** — the CSS variables, grid arrangement, and panel positions change, but the JS logic and function signatures are identical across all of them.

| Template | Layout Description | Best For |
|---|---|---|
| `base-automation` | Full-width team grid, sold panel on the right, ticker at bottom. SSE bridge connected by default. | Clients on Whatnot/TikTok who want live automation |
| `base-local` | Same visual as base-automation but no SSE bridge wired. Teams toggled by clicking only. | Clients who manage sales manually, no automation |
| `row-grid-scores` | Team grid rows with a live scores panel embedded. Ticker at bottom. | Clients who want real-time score display during breaks |
| `split-board` | Board splits into two halves — one side for teams, one side for sold list or cam feed area. | Face-cam setups, two-sport breaks |
| `three-column-cam` | Three-column layout: sold list | cam area | team grid. Designed around face cam being visible. | Face-cam-heavy streamers, premium setups |

### How the template flows into a build

```
Build Queue: Template = "base-automation"
                ↓
agent/run.js: spec.template = "base-automation"
                ↓
agent/generate.js: passes template name to Claude in the prompt
                ↓
Claude: generates index.html matching that layout structure
        using CSS variables and grid defined in STANDARDS section 3–4
```

### Path conventions (all templates)

- Team images: `../../images/{sport}/{team}.png` — relative from `overlays/{client-slug}/index.html`
- Logo (if provided): saved as `../../images/logos/{client-slug}-logo.png` and referenced by that path
- If no logo uploaded: header uses a styled text fallback — never a broken `<img>` tag
- All paths are relative — never absolute — so the overlay works both locally and when deployed

---

## 3. HTML Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>{Client Name} Overlay</title>
  <style>/* ... */</style>
</head>
<body>
  <div class="overlay-wrap">
    <div class="header">...</div>
    <div class="board" id="board">...</div>
    <div class="sold-panel" id="soldPanel">...</div>
    <div class="ticker-slot"><div class="ticker-track" id="tickerTrack"></div></div>
  </div>

  <!-- Modals -->
  <div class="modal-mask hidden" id="breakModal">...</div>
  <div class="modal-mask hidden" id="titleModal">...</div>
  <div class="modal-mask hidden" id="tickerModal">...</div>
  <div class="modal-mask hidden" id="exportModal">...</div>

  <script>/* ... */</script>
</body>
</html>
```

---

## 3. CSS Variables (`:root`)

All overlays must define these CSS variables on `:root`. Brand colors are the only values that differ per client.

```css
:root {
  /* Layout */
  --cols: 10;
  --gap: 6px;
  --tileH: 60px;

  /* Brand colors — customize per client */
  --accent:       #c9a84c;
  --accent2:      #8b5e1a;

  /* Background */
  --bg0: #0a0a0a;
  --bg1: #141414;
  --bg2: #1e1e1e;

  /* Text */
  --text:  #f0f0f0;
  --muted: #888;

  /* Borders */
  --border:       rgba(255,255,255,0.08);
  --borderStrong: rgba(255,255,255,0.20);

  /* Ticker */
  --tickerDur: 30s;
}
```

---

## 4. CSS Class Names

| Class | Purpose |
|---|---|
| `.overlay-wrap` | Outermost container, 1080px wide |
| `.header` | Top bar: title, break number, sport |
| `.board` | Team tile grid |
| `.tile` / `.team` | Individual team slot |
| `.tile.sold` | Sold state — applied via JS |
| `.sold-panel` | Right-side sold list |
| `.sold-entry` | A single row in the sold list |
| `.ticker-slot` | Fixed-height ticker container |
| `.ticker-track` | Scrolling inner element |
| `.modal-mask` | Full-screen modal backdrop |
| `.modal-box` | Modal content card |
| `.hidden` | Display-none utility (toggled by JS) |

---

## 5. Required JavaScript — State

```js
// Sport currently displayed
let sport = "nfl";   // "nfl" | "nba" | "mlb"

// Sold state — dual structure for O(1) lookup + ordering
const soldTeams    = new Set();          // fast membership check
let   soldTeamsList = [];                // [{code, buyer}] in sell order

// Respin dedup — prevents double-counting re-listed items
const lastCodeByListingKey = new Map();  // saleId → teamCode

// Break number
let breakNum = 1;
```

---

## 6. Required JavaScript — localStorage Keys

Use these exact key names for consistency across overlays:

| Key | Type | Purpose |
|---|---|---|
| `"breakNumber"` | number | Current break counter |
| `"titleMain"` | string | Primary header title |
| `"titleSub"` | string | Secondary header line |
| `"tickerText"` | string | Ticker message content |
| `"tickerSpeedSec"` | number | Ticker duration in seconds |
| `"soldTeamsList"` | JSON | Serialized `soldTeamsList` array |
| `"sport"` | string | Active sport slug |
| `"bridgeUrl"` | string | SSE bridge base URL |
| `"bridgeKey"` | string | SSE bridge auth key |

**Helpers — use these in every overlay:**

```js
function loadText(key, def = "")  { return localStorage.getItem(key) ?? def; }
function saveText(key, val)       { localStorage.setItem(key, val); }
function loadJson(key, def)       { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } }
function saveJson(key, val)       { localStorage.setItem(key, JSON.stringify(val)); }
function loadNum(key, def = 0)    { return Number(localStorage.getItem(key) ?? def); }
```

---

## 7. Required JavaScript — Core Functions

All overlays must implement these functions with these signatures:

### Team State
```js
function toggleTeam(code, buyer = "")  // click handler — flips sold/unsold
function markSold(code, buyer = "")    // adds to soldTeams + soldTeamsList, persists
function markUnsold(code)              // removes from both, persists
```

### Rendering
```js
function buildLayout()      // renders tile grid from breakTypes[sport].teams
function renderSoldList()   // rebuilds sold-panel from soldTeamsList
function updateStats()      // updates "X sold / Y remaining" counters
function syncHeader()       // pushes titleMain, titleSub, breakNum to DOM
function syncTickerTrack()  // pushes tickerText + --tickerDur to DOM
```

### Modals
```js
function openModal(id)   { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id)  { document.getElementById(id).classList.add("hidden"); }

// Each modal has an apply function that reads inputs and saves:
function applyBreakModal()
function applyTitleModal()
function applyTickerModal()
```

### Break lifecycle
```js
function resetAll()   // clears sold state, calls buildLayout() + renderSoldList()
function newBreak()   // increments breakNum, calls resetAll()
```

### Export
```js
function buildExportTSV()   // returns tab-separated string of sold data
function copyExportTSV()    // copies to clipboard, shows confirmation
```

---

## 8. breakTypes Data Structure

```js
const breakTypes = {
  nfl: {
    name: "NFL",
    cols: 10,
    tileH: 60,
    teams: [
      { code: "ARI", name: "Arizona Cardinals", image: "../../images/nfl/cardinals.png" },
      // ... 32 teams
    ]
  },
  nba: {
    name: "NBA",
    cols: 8,
    tileH: 52,
    teams: [ /* 30 teams */ ]
  },
  mlb: {
    name: "MLB",
    cols: 8,
    tileH: 52,
    teams: [ /* 30 teams */ ]
  }
};
```

- Always use uppercase 2–3 letter `code` values matching the image filenames.
- `cols` and `tileH` set the CSS variables `--cols` and `--tileH` at runtime via `buildLayout()`.

---

## 9. SSE Bridge Integration

```js
// Config — populated from URL params or localStorage
function getBridgeBase()    { return new URLSearchParams(location.search).get("bridge") || loadText("bridgeUrl"); }
function getBridgeKey()     { return new URLSearchParams(location.search).get("key")    || loadText("bridgeKey"); }
function bridgeEnabled()    { return !!getBridgeBase(); }

// Connect
function connectBridgeSSE() {
  if (!bridgeEnabled()) return;
  const sse = new EventSource(`${getBridgeBase()}/stream?channel=main`);
  sse.onmessage = (e) => handleSSEEvent(JSON.parse(e.data));
  sse.onerror   = ()  => setTimeout(connectBridgeSSE, 2500);
}

// Post an event back to the bridge
async function bridgePost(payload) {
  await fetch(`${getBridgeBase()}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-key": getBridgeKey() },
    body: JSON.stringify(payload)
  });
}
```

### Standard Event Types

| Event `type` | Required fields | Action |
|---|---|---|
| `"team_sold"` | `code`, `buyer`, `saleId` | `markSold(code, buyer)` |
| `"team_unsold"` | `code` | `markUnsold(code)` |
| `"reset"` | — | `resetAll()` |
| `"set_break"` | `value` | set `breakNum`, `syncHeader()` |
| `"set_sport"` | `value` | set `sport`, `buildLayout()` |
| `"set_title"` | `main`, `sub` | `syncHeader()` |
| `"set_ticker"` | `text`, `speedSec` | `syncTickerTrack()` |

### Respin Handling

```js
function handleSSEEvent(data) {
  const { type, code, buyer = "", saleId } = data;

  if (type === "team_sold") {
    // Respin: if this saleId was previously tied to a different code, unsell the old one
    if (saleId && lastCodeByListingKey.has(saleId)) {
      const prev = lastCodeByListingKey.get(saleId);
      if (prev !== code) markUnsold(prev);
    }
    if (saleId) lastCodeByListingKey.set(saleId, code);
    markSold(code, buyer);
  }
  // ... handle other types
}
```

---

## 10. Tile DOM Pattern

```js
function buildLayout() {
  const bt = breakTypes[sport];
  document.documentElement.style.setProperty("--cols", bt.cols);
  document.documentElement.style.setProperty("--tileH", bt.tileH + "px");

  const board = document.getElementById("board");
  board.innerHTML = "";

  for (const team of bt.teams) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.code = team.code;
    tile.innerHTML = `
      <img src="${team.image}" alt="${team.code}" onerror="this.style.display='none'">
      <span class="tile-code">${team.code}</span>
    `;
    tile.addEventListener("click", () => toggleTeam(team.code));
    board.appendChild(tile);

    // Restore sold state
    if (soldTeams.has(team.code)) tile.classList.add("sold");
  }
}
```

- Always use `data-code` attribute on tiles — used by `markSold`/`markUnsold` to query the DOM.
- Query tiles with: `document.querySelector(\`.tile[data-code="${CSS.escape(code)}"]\`)`

---

## 11. What NOT to Do

- **No inline `onclick=` attributes** — use `addEventListener` in `buildLayout()`.
- **No hardcoded pixel widths** in JS — use CSS variables so themes can override.
- **No duplicate localStorage keys** — use the standard keys in section 6.
- **No silent SSE failures** — always implement the `onerror` reconnect.
- **No raw `querySelector` with user data** — always wrap with `CSS.escape()`.
- **No separate JS files** unless the overlay has a specific documented reason — keep it self-contained.
