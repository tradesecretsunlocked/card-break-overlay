# Manual Documentation Updates Required

Two files need to be updated manually because they live outside the connected
workspace folder. Copy the content below into each file.

---

## File 1 — CLAUDE.md

**Location:**
`C:\Users\TSU\AppData\Roaming\Claude\local-agent-mode-sessions\...\local_f16bfd88-..\.claude\CLAUDE.md`

**Replace the entire file with:**

```
## Context: Trade Secrets Unlocked (TSU) Overlay Business

I run TSU — a sports card break overlay service. My primary work in Cowork sessions
involves building, editing, and debugging OBS browser-source overlay HTML files for
clients, and managing the build queue through Notion.

### What I build
Production-ready single-file HTML overlays for sports card break streamers. These are
OBS browser sources — no external JS libraries, no local file paths, fully self-contained.
Overlays are hosted and connect to a shared SSE bridge for real-time automation.

### Platform architecture
- Bridge: https://bridge.tradesecretsunlocked.com (multi-tenant, shared by all clients)
- Each client has a unique bridge key registered in Supabase (bridge_keys table)
- Keys are baked into each client's overlay HTML and Chrome extension at build time
- Clients never configure bridge URL or key manually — it's all pre-built
- Supabase tables: bridge_keys (access control), bridge_events (event log)

### Tech standards (always follow)
- ES6 only — no CDN dependencies, OBS Chromium has no network access for JS libs
- localStorage keys must be namespaced: {client-slug}.keyName (e.g. barn.breakNumber)
- Use LS constants object — never hardcode localStorage key strings inline
- CSS variables for all colors: --primary and --secondary at :root
- No prompt() or alert() — use the custom OBS-safe modal pattern
- SSE bridge automation for Tier 2+ clients (connectBridgeSSE with auto-reconnect)
- localStorage state persistence for Tier 2+ builds
- breakIdMatches(data) guard on every SSE event
- Bridge URL and key baked in as BRIDGE_URL_DEFAULT and BRIDGE_KEY_DEFAULT constants

### Bridge key standard
Every overlay must define:
  const BRIDGE_URL_DEFAULT = "https://bridge.tradesecretsunlocked.com";
  const BRIDGE_KEY_DEFAULT = "REPLACE_WITH_CLIENT_KEY"; // set at build time

getBridgeBase() and getBridgeKey() check URL params → localStorage → hardcoded default
(in that priority order, so testing overrides work without changing the file).

### Layout & design rules
- Always start from an existing reference overlay — never build layout from scratch
- Style/color/logo changes = surface only, keep structure identical
- Every overlay must have visible color contrast variance — no flat single-color designs
- Use gradients deliberately to draw the eye to key elements (header, ticker, sold panel)
- Required always: soldFlash, fallback image handling, export modal, Reset / New Break /
  Sold stat / Remaining always visible

### Build queue workflow (TSU Overlay Agent skill)
When I say "run the queue", "build [client name]", or "process pending builds":
1. Read TSU Build Queue in Notion (DB: 32d7e2ad-ff2f-809a-b2ea-c090c751cbb7, filter: Pending)
2. Pull client profile + transaction data from linked relations
3. Select layout family and feature set per heuristics
4. Build overlay using the closest reference template
5. Bake in BRIDGE_URL_DEFAULT and BRIDGE_KEY_DEFAULT for that client
6. Write output to overlays/_drafts/{client-slug}/index.html
7. Update Notion with result (never skip the Notion write-back)

### New client onboarding (post-build)
After overlay is built and approved:
1. Key is already in Supabase (added from migration-keys.sql or manually)
2. Build per-client extension zip (set DEFAULTS.bridgeKey in content.js)
3. Build OBS deployment package (scene collection + profile export)
4. Upload all files to client Google Drive folder
5. Schedule deployment appointment
See bridge/CLIENT-ONBOARDING.md and docs/WORKFLOW.md for full details.

### Priorities
- Stability over density — grid structure never changes at runtime
- Seller usability over cosmetic polish
- Consistent, maintainable code across all client builds
- When in doubt, refer to references/heuristics.md and references/feature-registry.md
  in the TSU overlay agent skill
```

---

## File 2 — automation-standard.md (DEFAULTS block only)

**Location:**
`...\skills\tsu-overlay-agent\references\automation-standard.md`

**Find this block:**
```js
const DEFAULTS = {
  bridgeUrl: "https://tsu-bridge-[CLIENT].onrender.com", // ← ONLY change this
  bridgeKey: "",
  sport: "nfl",
  overlayId: "",
  channel: "main",
  pollMs: 3000,
  summaryEvery: 5
};
```

**Replace with:**
```js
const DEFAULTS = {
  bridgeUrl: "https://bridge.tradesecretsunlocked.com", // shared bridge — same for ALL clients
  bridgeKey: "REPLACE_WITH_CLIENT_KEY",                 // unique per client — only this changes
  sport: "nfl",       // "nfl" | "nba" | "mlb" | "nil"
  overlayId: "",      // e.g. "northland" — optional metadata
  channel: "main",
  pollMs: 3000,
  summaryEvery: 5
};
```

Also add this note directly after the DEFAULTS block:

```
> **Bridge architecture (updated May 2026):** All clients share one bridge at
> `bridge.tradesecretsunlocked.com`. Traffic is isolated by `bridgeKey`.
> Each client's key must be registered in Supabase (`bridge_keys` table, active = true)
> before their overlay or extension will work. Unregistered keys get a 403.
> Do NOT use per-client onrender.com URLs — those are being decommissioned.
```
