# card-break-overlay — Repo Orientation

This repo powers TSU's overlay service. Every card-break streamer who buys an overlay gets a customized HTML overlay served from GitHub Pages + a Chrome extension that watches their Whatnot stream and pushes sales to a shared bridge.

## Architecture (the 60-second version)

```
Whatnot stream (host's browser)
  → content.js  [Chrome extension]
  → POST /events  →  bridge.tradesecretsunlocked.com  (Render, shared, always-on)
                     ↳ Supabase logs every event to `bridge_events`
                     ↳ SSE stream broadcasts to overlay
  → overlay/index.html  [OBS browser source]
```

**One bridge serves all clients.** They're isolated by `bridge_key` (UUID, validated against Supabase `bridge_keys` table) and `channel` (always `"main"` for now). No per-client Render services anymore.

## Directory map

| Path | What |
|------|------|
| `overlays/<client>/index.html` | Production overlay served from GitHub Pages. The OBS browser source URL points here. |
| `overlays/<client>/` | Per-client assets (logos, fx, audio). |
| `images/` | Shared sport assets — `nfl/`, `nba/`, `mlb/`, `nhl/`, `logos/`, `fx/`. |
| `extension-UPDATED-04-14-2026/` | **Canonical extension template (v2.2.1, updated 2026-07-03).** Clone from here for new clients. See "Extension version" below for the v2.2.1 changelog. |
| `tsu-extension-v2.2/extension/` | Mirror of the canonical template, kept in sync (v2.2.1). |
| `extension-template/` | Older mirror. Also kept in sync (v2.2.1). |
| `bridge/server.js` | The shared Node bridge. SSE + REST. Deployed to Render. |
| `CURRENT-PROD-BACKUP=TEMPLATE-05-18-2026/bridge/` | Snapshot of the production bridge for reference/rollback. |
| `_drafts/<client>/` | In-progress builds before they go to `overlays/`. The build agent stages here for Mike's review. |
| `.claude/skills/` | Repo-scoped Claude skills (troubleshoot playbook). |

## Per-client extension lives outside this repo

Client extensions live in OneDrive at `C:\Users\TSU\OneDrive\cheech\Poke\TSU\Client files\<client>\extension-UPDATED-04-14-2026\`. When a client extension needs fixing, patch BOTH the OneDrive copy AND the canonical template in this repo so future clients inherit the fix.

## The three things that differ between clients

Everything else is templated. Per-client config lives in three places:

1. **Extension `content.js` DEFAULTS** — `bridgeKey`, `sport`, `overlayId`, `channel`
2. **Overlay `index.html` constants** — `BRIDGE_BASE` (always the same), `BRIDGE_KEY` (matches extension), default `overlayId` (matches extension)
3. **Supabase `bridge_keys` row** — must have `active = true` for the client's key

If any one of those three is wrong, the client breaks. See `~/.claude/projects/.../memory/project_infrastructure.md` deploy checklist for the full setup sequence.

## Known bugs and standards

The single source of truth for "is this client up to standard" lives in:

`~/.claude/projects/C--Users-TSU-Documents-GitHub/memory/project_infrastructure.md`

Read the "Confirmed Working Standards" section before patching anything. The "Pre-deploy standard-compliance audit" is a grep-able pass/fail checklist run against every client extension+overlay before deploy.

## When working in this repo

- **New overlay from queue** → invoke the `tsu-overlay-agent` skill (in the `anthropic-skills` plugin namespace).
- **Live overlay broken** → invoke `tsu-overlay-troubleshoot` (this repo, `.claude/skills/`).
- **Bug-fix that applies to all clients** → patch the canonical templates first (`extension-UPDATED-04-14-2026/`, `tsu-extension-v2.2/extension/`, `extension-template/`), then propagate to the affected client(s) in OneDrive.
- **Combo/custom layouts** (Jim & Tabby pattern) → the chaser-label prefix-match fix uses `labelMatches()` with a digit-boundary check; longest-label-first sort. Don't reintroduce `raw.includes(label)`.

## Deploy targets

- **Overlays** → GitHub Pages serves `https://tradesecretsunlocked.github.io/card-break-overlay/overlays/<client>/index.html`. Pushing to `main` deploys.
- **Extensions** → no deploy. Client installs locally via `chrome://extensions` → Load Unpacked. Zip the folder for delivery.
- **Bridge** → Render auto-deploys on push to `main` for files in `bridge/`. Rare; treat as production.

## Conventions

- Hardcode the bridge URL and bridge key in BOTH the extension and the overlay. Never read either from localStorage as the primary source — stale values from the old per-client Render era will override. Use URL params (`?bridge=`, `?key=`) only as opt-in overrides.
- `overlayId` in the extension DEFAULTS must equal the overlay's default `overlayId`. Mismatch = no events received.
- `warmupPing` POSTs to `/events` with `type: "overlay_warmup"`. There is no `/warmup` endpoint on the bridge.
- Manifest must include `"https://bridge.tradesecretsunlocked.com/*"` in `host_permissions` and `"storage"` in `permissions`. Remove any leftover `"https://*.onrender.com/*"`.

## Extension version

**Current canonical: v2.2.1 (updated 2026-07-03).** Every new client extension built from the canonical inherits this baseline. Existing pre-v2.2.1 client extensions in OneDrive are NOT auto-updated — only patch them if a specific client hits one of the bugs fixed below.

**v2.2.1 changelog (vs v2.2 April 2026):**
- `[CRITICAL]` **localStorage persistence for the dedup `seen` map.** Survives page reloads. Prevents 60+ historical sold items resending in one poll cycle when OBS refreshes the source or the machine restarts mid-break.
- `[RELIABILITY]` **Adaptive pagination — early-stop + per-page isolation.** Fixes the 500-error avalanche during 24/7 deep-pagination polling. A single bad page no longer poisons the whole cycle.

**Canonical template DEFAULTS are placeholders** (`REPLACE_WITH_CLIENT_UUID_FROM_SUPABASE`, `REPLACE_WITH_CLIENT_SLUG-overlay`). The `tsu-overlay-agent` skill's Step 7 replaces them per client. Never leave placeholder values in a client-delivery zip.
