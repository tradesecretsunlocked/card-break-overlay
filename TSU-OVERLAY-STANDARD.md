# TSU Overlay Standard: Build, Wire and Deploy Reference

**Version:** 2.4 | **Header last bumped:** 2026-07-30 | **Content watermark:** 2026-08-18 | **Owner:** Mike (PMM) | **Review cadence:** on every canonical-reference change

> **Read the inline dates, not the version number.** This file carries unversioned
> amendments dated after the 2.4 header: 2026-08-11 (extension v2.3 `sellerUsername`),
> 2026-08-12 (scores HOST rule), 2026-08-15 (dedup key uniqueness, v2.3.1) and
> 2026-08-18 (scores host verification gate, overlay parse gate, deployed-file rule).
> Where a checklist and an inline dated block disagree, the dated block wins.

## Authority and scope

This document is **canonical for one thing: how a TSU overlay, its Chrome extension, its bridge wiring and its Supabase key are built.** Inside that scope, when this file disagrees with an older note, a code comment, or an archived standard, this file wins.

It is not the top of the tree. The order of authority is:

1. **Live systems.** The bridge source (`card-break-overlay/bridge/server.js`), the deployed edge functions, the live Supabase project, and the overlay files actually in `overlays/`. If code disagrees with this document, the code is the fact and this document is the bug. Fix the document.
2. **`TSU-MEMORY.md`** for what TSU is, current business state, the data model and the repo map.
3. **This document** for overlay, extension, bridge and key mechanics.
4. **`card-break-overlay/docs/SOP-CLIENT-PROVISIONING.md`** for the operational runbook (purchase to deployed). It cites this document rather than restating it.

Everything else in the repo is reference, and much of it is stale.

**Superseded by this file, do not use:** `card-break-overlay/STANDARDS.md`, `tsu-agent/standards/STANDARDS.md`, the `03-09-2026-NEW-REQUIRED-STANDARDS` set, and `OBS Overlay Automation + Bot deployment/TSU-OVERLAY-CODE-STANDARD.md` (merged into this file on 2026-07-30 and archived). `TSU-SYSTEM-STANDARDS.md` no longer claims to be canonical for overlay wiring and now points here.

## What changed in 2.4

| Change | Detail |
|---|---|
| **Scores channel corrected** | v2.3 said `getScoresChannel()` must return `` `sports-${SCORES_NAMESPACE}` `` and labelled bare `"sports"` as OLD / WRONG. **That was backwards.** Bare `"sports"` is correct and is what 17 of the 19 scores-wired overlays already do. See §11 for the full evidence. Sections 11, 18, 19 and 20 are all corrected. |
| **Two layout families documented** | The Divisions/Board and Row-grid families, their canonical references, file anatomy, naming conventions, CSS variable vocabularies and required function lists, all merged in from `TSU-OVERLAY-CODE-STANDARD.md`. New sections 2 through 6. |
| **`--primary` / `--secondary` settled** | They are permitted and encouraged as **aliases** at `:root` onto the family accent and background variables. They are not a third vocabulary. See §5. |
| **`bridge_keys` schema fixed** | The CREATE TABLE in v2.3 omitted `client_email` and `owner_contact_id`. `client_email` is load bearing: it feeds the portal auto-link trigger. See §16. |
| **Extension manifest drift closed** | Every live extension template already carries `bridge.tradesecretsunlocked.com/*` in `host_permissions`. Only `archived/extension/` still has the legacy `*.onrender.com` entry. The checklist item stays as a verification, the "the template is broken" claim is retired. |
| **Automation contract expanded** | Full `team_sold` payload shape, the complete event alias list, the five-step code resolution with the name-first matcher rule, `breakIdMatches`, and the dedup rule (never key on `productId`). New §9. |
| **Dedup key uniqueness rule (v2.3.1)** | New in §9.3 and the §7 pre-ship gate after the 2026-08-15 Breakz4Dayz incident: a dedup key built from listing and/or buyer identity collapses every spot one buyer wins, and the extension then unsells spots that were legitimately sold. Includes the two-sided test any key must pass. Affected 12+ clients before detection. |
| **Buyer uniqueness RETIRED (2026-08-21)** | §9.3 previously required unselling any tile a buyer already held before giving them a new one. It is now retired and must be removed on sight. A buyer winning several spots in one break is normal. Live incident: Bigger Than Cardboard, three full 32-team NFL breaks whose boards finished on 13, 10 and 12 tiles, 61 spots wrongly put back, export short by 61 of 96 rows, with every sale id distinct so dedup was not involved. The rule prevented nothing: two buyers on one tile is already handled by sale-id reassignment. |
| **New drift recorded** | The repo copy of `provision-client` no longer matches the deployed function. See §21.1. |
| **Authority claim narrowed** | v2.3 called itself "the single source of truth" for everything. Three documents made that claim at once. Only the scoping above survives. |

---

### Amendments after the 2.4 header (read these, they are newer than the version number)

**2026-08-18 — three new provisioning gates, all from the Blue Light Rips audit.**

1. **Scores are not verified until the HOST is verified.** A scores fault is only closed after
   confirming the overlay points at `tsu-scores-bridge.onrender.com`, not merely that
   `getScoresChannel()` returns `"sports"`. Blue Light Rips was marked fixed on 2026-08-15 with
   the channel correct and the host wrong, and stayed dark for three days. Right channel plus
   wrong host is indistinguishable from working code from the outside: the connection opens,
   nothing errors, nothing arrives. See §11 and `docs/SCORES-CONFIG-AUDIT.md`.

2. **Every overlay must parse before it ships.** Extract the inline `<script>` and run
   `node --check` on it. A TSU overlay has exactly one inline script, so a single syntax error
   anywhere kills the entire block — no tiles, no SSE, no handlers — while the static HTML shell
   still paints, which disguises it as a data problem. This is now the same hard gate
   `content.js` has had since 2026-08-11.

3. **Diagnose against the DEPLOYED file, never the local working copy.** The mounted repo has no
   network egress, so local edits never reach GitHub Pages on their own and drift silently. Pull
   the served file first and diff. On 2026-08-18 a local copy differed from the deployed one by a
   stray keystroke that would have blanked a live client's board had it ever been pushed.

**2026-08-18 — asset paths: Supabase storage is intake, not a runtime host.**

Every asset an overlay loads MUST resolve through the `BASE` constant and live in this
repo. Supabase `client-uploads/` is where a client's logo lands during **intake**; it is
not a CDN and must never be referenced from a live overlay.

```js
const LOGO_PATH = `${BASE}images/logos/<client-slug>-logo.png`;   // correct
const nflImg = (f) => `${BASE}images/nfl/${f}`;                   // correct
const LOGO_PATH = "https://....supabase.co/storage/v1/.../logo.png";  // WRONG
```

Canonical layout, and `BASE` resolves correctly from both `_drafts/<client>/` and
`overlays/<client>/` because both are two levels deep:

```
card-break-overlay/images/logos/<client-slug>-logo.png
card-break-overlay/images/nfl|nba|mlb/<team>.png
card-break-overlay/overlays/<client-slug>/index.html
```

**Build step:** mirror the client's uploaded logo from `builds.logo_url` into
`images/logos/<client-slug>-logo.png` and reference it from there. Pointing at the
Supabase URL because the repo asset "does not exist yet" is not an acceptable shortcut —
it makes a live overlay depend on a bucket's public policy and URL format, outside this
repo and outside version control.

**Drift found 2026-08-18, all resolved 2026-08-19.** Fixed copies are staged in
`_drafts/` and await promotion; the `overlays/` originals are untouched by the agent.

| Client | What was wrong | State |
|---|---|---|
| `tyschap-breakz` | `LOGO_PATH` set to a Supabase URL. The correct asset already existed at the standard path and was never checked | Fixed |
| `coachs111sports` / `coachs111breaks` | Supabase URL first in `BRAND_LOGO_CANDIDATES`, and **every fallback pointed at H-Vault's logo** — a failed load would have put another client's branding on stream | Fixed, chain reduced to one in-repo asset |
| `heat-check-cards` | Dead `LOGO_PATH` constant left after the header logo was removed by design | Constant removed |

**Second rule out of the coachs111 case: never put another client's asset in a fallback
chain.** Showing nothing is always better than showing the wrong client's branding. A
fallback chain should contain one client's assets only.

**Also corrected 2026-08-18:** two `known_issues` rows were marked `fixed` when they were not —
`overlay-scores-missing-sports-channel` (the 08-15 wrong-host "fix") and
`extension-stableid-collapse-unsells-spots` (fixed in the template only, while deployed client
builds still carried it). **A fix landing in a template is not a fix landing with a client.**
Record the distribution state, not just the code state.

**2026-08-24: the baked key is primary, and a URL override must not outlive its page load.**

Found on coachs111 while splitting one shared overlay into two. `getBridgeKey()` and
`getBridgeBase()` wrote the `?key=` / `?bridge=` value into `localStorage` and then read
`localStorage` **ahead of** the baked constant. The override therefore survived the load that
set it and won on every load afterwards, while the OBS URL looked clean. One debug load,
weeks earlier, is enough. Nothing errors.

```js
function getBridgeKey(){                      // correct
  const q = param("key");
  if (q && q.trim()) return q.trim();         // this load only, NOT persisted
  return BRIDGE_KEY;                          // baked constant is the source of truth
}

function getBridgeKey(){                      // WRONG
  const q = param("key");
  if (q && q.trim()){ localStorage.setItem("overlay.bridge.key", q.trim()); return q.trim(); }
  return localStorage.getItem("overlay.bridge.key") || BRIDGE_KEY;   // localStorage wins
}
```

The legacy `tsu.bridgeUrl` / `tsu.bridgeKey` / `tsu.url` / `tsu.key` fallback chains have the
same defect and are removed on sight. This restates §8: the key is baked into the file, the
URL parameter is a debugging affordance, and `localStorage` is never primary.

**Gate:** grep every overlay for `localStorage.setItem` inside `getBridgeKey` or
`getBridgeBase`, and for any `localStorage` read that precedes the baked default. Tracked as
`known_issues` bug 23.

**2026-08-24: multi-account clients: five things separate, not one.**

Two overlays for one client share a GitHub Pages origin, which is one `localStorage` scope, and
their two extensions share whatnot.com, which is another. Everything not namespaced is shared.
For coachs111 (SPORTS + BREAKS, both live at once) the full list is:

| Layer | Where | Failure if shared |
|---|---|---|
| baked `BRIDGE_KEY` | overlay | real isolation layer, enforced at the bridge |
| `LS_PREFIX` | overlay | sold state, ticker, promos, break number all trample |
| `overlayId` + `overlayIdMatches()` | overlay | sibling account's events are accepted |
| `sellerUsername` (v2.3 gate) | extension | each extension captures whichever show is open |
| `tsu.seen:<overlayId>` | extension | one account's sales look already-processed to the other and are dropped |

`overlayIdMatches()` must pass events that carry no overlay field, or a producer that omits it
goes dark. The dedup namespace is the newest of the five: the canonical
`extension-template/content.js` still writes a bare `tsu.seen`, which is safe for single-account
clients but must be namespaced before the next multi-account build. Tracked as `known_issues`
bug 24. Worked example: `_drafts/coachs111sports/LAYOUT-NOTES.md`.

**2026-08-24: extension template is v2.3.2. Ask whether the board is title-matched.**

`inferCodeFromTitle()` returns a team code in exactly three cases: the title carries a real team
name or alias, a bare team-code token, or a bare slot number in an approved form (`spot 4`,
`envelope 12`). Everything else returns `""`. v2.3.1 then did `if (!code) continue;`, dropping the
sale **before it reached the bridge**, with no error and no `bridge_events` row. The v2.2 lineage
had a `sendUnresolved` flag for exactly this and it was lost when v2.3 was cut.

Restored in v2.3.2, defaulting to `false` so team-board behaviour is unchanged:

```js
sendUnresolved: false,                                 // DEFAULTS: set true per client
if (!code && !DEFAULTS.sendUnresolved) { ... continue; }
const newIsReal = !!code && !code.startsWith("CUSTOM_");
```

Set it `true` for any board whose spots are matched by NAME rather than by team code: repack and
bundle boards, player-name boards, custom-tile boards, and chasers or packs sold as their own
listings. Leave it `false` for a standard team board, where a code-less event could let a junk
listing fuzzy-match a tile.

**Decide by reading the overlay, not by vocabulary.** `markSold(code)` against a team table means
`false`. `findSpotByText(title)` or any name lookup means `true`. `blue-light-rips` uses the word
"chaser" heavily but marks chasers as flagged TEAM tiles, so its chaser sales carry a normal code
and the flag does nothing for it. Fleet audit 2026-08-24: `blue-light-rips`, `breakz4dayz` and
`birdie-breaks` are all pure team-code boards; `coachs111` repack was the only title-matched board.

v2.3.2 also namespaces the extension dedup map to `tsu.seen:<overlayId>` (bug 24), with a
migration shim that adopts the legacy bare-key map on first run. Without the shim an update starts
with an empty map and the next poll re-sends the whole current sold list, replaying it with
animations and buyer popups. **Clients update between shows, never mid-break.**

**Companion docs.** `docs/SCORES-CONFIG-AUDIT.md` (which overlays are wired correctly for scores),
`docs/OVERLAY-FEATURE-NOTES.md` (nuance and one-off seller-facing features, and the trap behind
each), `.claude/skills/tsu-overlay-troubleshoot/SKILL.md` (the live-fault bug catalog), and the
Supabase `known_issues` table (what TSU Assist can tell a seller).

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Two Layout Families](#2-the-two-layout-families)
3. [File Anatomy](#3-file-anatomy)
4. [Naming and State Conventions](#4-naming-and-state-conventions)
5. [CSS Variables and Theming](#5-css-variables-and-theming)
6. [Required Functions Per Family](#6-required-functions-per-family)
7. [Extension Setup](#7-extension-setup)
8. [Overlay Bridge Wiring](#8-overlay-bridge-wiring)
9. [The Automation Contract](#9-the-automation-contract)
10. [Overlay Automation Requirements](#10-overlay-automation-requirements)
11. [Live Scores](#11-live-scores)
12. [Per-Client Services](#12-per-client-services)
13. [Sold Panel: The Correct Pattern](#13-sold-panel-the-correct-pattern)
14. [Required UI](#14-required-ui)
15. [Stability Rules](#15-stability-rules)
16. [Supabase: New Client Key](#16-supabase-new-client-key)
17. [Custom Outliers: Never Clone These](#17-custom-outliers-never-clone-these)
18. [Deploy Checklist](#18-deploy-checklist)
19. [Validation Checklist](#19-validation-checklist)
20. [Known Bugs and Anti-Patterns](#20-known-bugs-and-anti-patterns)
21. [Known Drift Still Open](#21-known-drift-still-open)
22. [Quick Reference: Per-Client Diff](#22-quick-reference-per-client-diff)

---

## 1. Architecture Overview

```
Whatnot live page (or Loupe broadcast page)
   └── Chrome Extension (content.js + injected.js, MV3)
           │  polls the host GraphQL / Firestore every ~3s, resolves team codes
           │  POSTs team_sold / team_unsold to the bridge with x-bridge-key
           ▼
   bridge.tradesecretsunlocked.com        shared, always-on, Render, Node/Express
           │  validates x-bridge-key against Supabase bridge_keys (cached ~5 min,
           │  fails open on a Supabase outage so overlays never go dark)
           │  logs business events to bridge_events
           │  SSE-broadcasts scoped by (bridge key + channel)
           ▼
   Overlay: overlays/<client>/index.html, OBS browser source, GitHub Pages
           │  SSE subscribe: /stream?channel=main&key=<bridge key>
           │  SSE subscribe: /stream?channel=sports&key=<bridge key>
           │  marks teams sold, patches the sold list, animates
           ▼
   Supabase (project tsu-bridge)   bridge_keys + client_services + bridge_events
```

### Key facts

- **One shared bridge for every client:** `https://bridge.tradesecretsunlocked.com`. There are no per-client Render services. Do not create new Render instances. The old `tsu-bridge-<client>.onrender.com` model is retired, ignore it wherever an older doc mentions it.
- **Clients are isolated by bridge key, not by channel name.** The bridge keeps a `Map<bridgeKey, Map<channel, Set<connection>>>` and only ever broadcasts inside one key's bucket. Two clients both listening on `channel=main` never see each other's events. This is the single most misunderstood part of the system and it is the root of the scores confusion corrected in §11.
- **Channel is a sub-address inside a key, not a tenant boundary.** There are exactly two channels in use: `main` for sales, `sports` for scores.
- **`401` = missing bridge key. `403` = key not found in `bridge_keys`, or `active = false`.**
- **Scores are opt-in per client** through the `client_services` table. Toggling a row turns scores on or off with no code change and no redeploy.
- **The overlay and the extension never talk to each other directly.** Everything goes through the bridge. This is why the overlay is platform agnostic: it consumes a canonical `team_sold` event and cannot tell whether the sale came from Whatnot or Loupe. The extension is the only platform-specific piece.
- **Future services** (stream stats widgets, promo feeds) follow the same `client_services` toggle pattern.

### Quiet-list for revoked keys

The bridge holds a `QUIET_SUBSCRIBE_KEYS` set. For a listed key, an SSE **subscribe (GET)** is accepted as an idle connection: it receives zero events, because nothing publishes to a revoked key, while **publish (POST) is still rejected with 403**. This exists so an abandoned OBS browser source stops 403-looping and flooding the bridge logs. Add a key here while its overlay is being rebuilt, and remove it afterwards. It currently lists Jim and Tabby (`469c3440…`).

---

## 2. The Two Layout Families

> **Rule #1: a new build is a CLONE of a canonical reference with scoped surface edits only.** Never built from scratch, never re-architected. Builds drift when each overlay is improvised, and finalizing small details (chips, titles, names, automation matching) then takes far longer than it should.

There are exactly **two** families that may be used as the base for a new build. Everything else in `overlays/` is either one of these two, an older generation that predates the standard, or a one-off custom outlier that is reference-only (see §17).

| Family | Canonical reference | Use it for |
|---|---|---|
| **Divisions / Board** | `overlays/how-you-doin/index.html` (near-identical: `overlays/bigtime/index.html`) | Conference and division boards, custom-named spot boards, anything with a live STANDARD to alternate board toggle, and any build where **a team sale should fold into a division or group**. This is the modern standard and the family Salute is built on. |
| **Row-grid** | `overlays/legends-hobby/index.html` | Straight team grids, one tile per team, optional ticker or promo, custom-spot add-ons. |

**How to choose:** if the board is grouped (divisions, conferences, custom envelopes, or anything where a sale marks a group rather than a single tile), use **Divisions/Board**. If it is a flat one-tile-per-team grid, use **Row-grid**.

The two families intentionally differ on a few naming conventions, documented in §4. **That is allowed.** The rule is consistency *within* a family, not across families. Do not mix patterns from both into one file.

---

## 3. File Anatomy

Both families share this:

- **One self-contained `.html` file.** No external JS or CSS, no CDN. OBS Chromium has no network access for libraries.
- **One inline `<style>` block** at the top and **one inline `<script>` block** at the bottom. Do not split into multiple script blocks.
- **ES6 only.** No `prompt()` and no `alert()`. Use the OBS-safe modal pattern.
- Served from GitHub Pages at `…/overlays/<client>/index.html`. Per-client assets (logo, background art) live in that client's overlay folder. Shared sport art lives in `images/<sport>/` and `images/logos/`.
- **Asset paths resolve through the `BASE` constant, never a bare relative URL in CSS.** A bare relative `url()` in CSS does not resolve reliably in the hosted OBS context, which is why the logo and background are set from JS. Salute's JS-set `#bgArt` layer is the correct pattern for background art.

### Document structure, in order

**Divisions/Board family.** `.overlay` is the single wrapper.

```
<body data-sport="...">
  <div class="overlay">
    <div class="header ... wick">      header bg, .brand (#brandTitle / #brandSlogan),
                                       .brand-logo (#brandLogo), chips (#sportChip,
                                       .break-box to #breakIdDisplay, #sseStatus / #sseText)
    <div class="main">
      <div class="teams-section" id="teamsSection">
        <div id="conferenceLeft" class="conference">
        <div class="control-bar">      Reset, #teamsSold (Sold), #teamsLeft (Remaining), Next
        <div id="conferenceRight" class="conference">
    <div class="ticker wick">          #tickerTrack to #tickerA / #tickerB
    <div id="soldControlsWrap">        .sold-controls (admin buttons, sport switch, export)
    <div class="sold-list" id="soldList">
  </div>
  ...popups (#titlePopupMask, #tickerPopupMask, #breakPopupMask, export popup)...
  <script> ... </script>
```

**Row-grid family.** `.container` is the wrapper. Logo and ticker are injected as grid rows. Note that `#soldFxLayer` sits **outside** `.container`.

```
<body>
  <div id="soldFxLayer">                 rich sold FX layer
  <div class="container">
    <div class="header" id="header">      .header-text (#headerText),
                                          .break-pill (#breakNumberDisplay)
    <div class="main-content">
      <div class="teams-wrapper" id="teamsWrapper">    rows injected here
      <div class="controls-row">          #teamsLeft (REMAINING), promo, #teamsSold (SOLD)
  <div class="sold-list-container">
    .sold-controls (NEW BREAK / BREAK# / SPORT / TITLE / TICKER / PROMO / COPY SOLD,
                    plus optional CHASE / SPOTS)
    #sseStatus (SSE, #sseDot, #sseText)
    <div id="soldList" class="sold-list-grid">
  ...modals (#tickerModal and friends)...
  <script> ... </script>
```

---

## 4. Naming and State Conventions

| Concept | Divisions/Board (canonical) | Row-grid (canonical) |
|---|---|---|
| Break-type config object | `const BREAK_TYPES` (upper) | `const breakTypes` (lower) |
| Per-type shape | `{ label, mode, conferences, divisions, divisionCodes }`, `mode` is `teams` or `divisions` | `{ name, cols, layout, teams:[{code,name,image}] }` |
| Board model | **`boardState` = `{ CODE: {sold, buyer} }`**, the source of truth | `breakTypes[sport].teams[]` plus `soldTeams` |
| Sold set | `const soldTeams = new Set()` | same |
| Sold ordered list | `let soldTeamsList = []` of `{code, buyer}` | same |
| Current type and number | `currentBreakType`, `currentBreakNumber` | `currentBreakType` plus `loadBreakNumber()` |
| Respin and dedup map | `lastCodeByListingKey` (Map) | `lastCodeBySaleId` (Map), same role |

### localStorage keys: the universal rule

Every client-state key is namespaced with a **per-client prefix** through a single `const LS = {…}` map: `<client>.breakNumber`, `<client>.tickerLines`, `<client>.breakType`, `<client>.soldState` and so on (for example `salute.*`, `legends.*`, `hydc.*`).

The **only** cross-client keys are the bridge ones: `tsu.bridge`, `tsu.key`, `tsu.overlayId`, `tsu.channel`. Never hardcode a bare key string, always go through `LS`.

> **Known drift to avoid:** the older flat-grid overlays (`southside-collects`, `hoovs`) use `breakTypes` (lower) with no `boardState`, no division mapping, and a generic `tsu.` / `getStateKey()` namespace instead of `<client>.`. Do not use them as a base.

---

## 5. CSS Variables and Theming

Theming is driven entirely by `:root` custom properties. Each family has its own established vocabulary. **Do not invent a third vocabulary per build.**

**Divisions/Board:** `--bg0 --bg1 --panel --panel2 --gold (#fede26) --gold2 --orange --cream --white --line --line2 --ok --danger --tileH --W (1080px) --radius --tickerDur --division-cols --team-height --board-height`.

Per-client surface edits are **the color variables only** (`--gold`, `--bg0`, `--bg1`, accents). Structure variables (`--W`, `--division-cols`, `--board-height`) stay put.

**Row-grid:** `--tileHTeam (58px) --tileHDivision (49px) --tileH --gap (5px) --cols (10) --white --muted --accentBorder --accentBorderSoft --iceBorder --bg0 --bg1`.

Per-client surface edits are **`--accentBorder` (plus `--accentBorderSoft`) and `--bg0` / `--bg1`**. `--accentBorder` is the client's primary color.

### `--primary` and `--secondary`: settled 2026-07-30

The standing TSU instruction is that every overlay declares `--primary` and `--secondary` at `:root`. Five of the 85 overlay folders do this today (`5th-quarter`, `NationofCards`, `makspaks`, `noco`, `ssc`). The other 80 use the family vocabularies above. An earlier draft of the code standard claimed no overlay used them at all, which was wrong.

**The resolution: declare `--primary` and `--secondary` as aliases onto the family variables.** They are canonical names for the client's two brand colors, not a replacement vocabulary. Every rule in the file keeps referencing the family variable.

```css
:root{
  /* client brand, the two values a build actually changes */
  --primary:   #f83a3a;
  --secondary: #141415;

  /* Row-grid family: alias onto the real variables */
  --accentBorder:     var(--primary);
  --accentBorderSoft: color-mix(in srgb, var(--primary) 45%, transparent);
  --bg0:              var(--secondary);
  --bg1:              #0b0b0c;
}
```

For the Divisions/Board family, alias `--gold: var(--primary)` and `--bg0` / `--bg1` off `--secondary` the same way.

**Non-negotiable either way:** every overlay must have **visible color contrast variance**. No flat single-color designs. Use gradients deliberately to draw the eye to the header, the ticker and the sold panel.

---

## 6. Required Functions Per Family

**Divisions/Board.** Every file in this family has these, with these signatures:

`buildLayout()` · `allEntriesForCurrentSport()` · `ensureBoardState()` · `makeDivisionGroup(divMeta, side)` · `buildConference(container, side, title, rows)` · `applySale(code, buyerName, sold)` (**the single mutation point**) · `sseMarkSold(code, buyer='')` · `sseMarkUnsold(code)` · `sseUpdateBuyer(code, buyer='')` · `renderSoldPanel()` · `updateStats()` · `inferTeamCodeFromTitle(title, sport)` · `breakIdMatches(data)` plus `computeBreakId()` · `initSSE()` / `connectOneSSE(...)` · `buildExportTSV()` plus `copyExportTSV()`.

**Row-grid.** Every file in this family has these:

`buildLayout()` (branches on `config.layout`: `NFL_32`, `NBA_MLB_30`, `SOCCER_20`, `CUSTOM_30`) · `makeTeamDiv(team)` · `makeLogoSlot(spanCols)` · `makeTickerSlot(spanCols)` · `toggleTeam(code, buyerFromSSE='')` · `updateStats()` · `updateSoldList()` · `inferCodeFromTitle(title, sportHint)` · `sseMarkSold` / `sseMarkUnsold` · the SSE `ingest` to `handleSSEEvent` pair.

**Row-grid layout idiom.** Each row is a `.row-grid`. The top row is `.row-grid.row-logo` with a centered `makeLogoSlot(2)`. The ticker is placed with `makeTickerSlot(N)`. The standards are `NFL_32` = (4 + logo + 4), 10, 10, bottom; and `NBA_MLB_30` = (3 + logo + 3), three 8-rows, ticker row.

---

## 7. Extension Setup

### Files required (three)

| File | Source | Notes |
|---|---|---|
| `manifest.json` | Copy from any current template | Identical for every client, change nothing |
| `content.js` | Copy from the template, edit the DEFAULTS block | Only DEFAULTS change per client |
| `injected.js` | Copy verbatim | Never modify |

Current templates on disk, all four verified to carry the bridge host permission: `extension-template/`, `extension-UPDATED-04-14-2026/`, `tsu-extension-v2.2/extension/`, and the per-client forks. **`archived/extension/` is the one exception and must never be used:** its `host_permissions` still lists legacy `https://*.onrender.com/*` and omits the bridge domain.

### Pre-ship gate for `content.js` (all four required, no exceptions)

Run these before zipping any client build. Items 1 and 2 have each caused a production incident.

1. **`node --check content.js`.** The template shipped truncated and unparsable once (recovered 2026-08-11 from a client install zip). A file that does not parse does nothing at all, silently.
2. **Inspect `stableId()` before shipping.** Confirm the fallback is not built only from listing and/or buyer identity, and run the two-sided test in §9.3. This is the 2026-08-15 incident and it reached 12+ clients before anyone noticed, because the symptom (a spot quietly reverting) looks like a seller misclick rather than a bug.
3. **`grep -n 'REPLACE_WITH' content.js`** returns only the startup guard line, never a DEFAULTS value.
4. **`sellerUsername` is baked** with the client's real Whatnot handle, lowercase, no `@`. Capture is disabled while unset, deliberately. Never guess it and never ship the placeholder.

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

> ⚠️ `host_permissions` MUST include `bridge.tradesecretsunlocked.com/*`. Without it, Chrome MV3 **silently** blocks every POST to the bridge. No error, no 401, no console warning, just silence. This is the single hardest failure in the system to diagnose from the client's side.

### DEFAULTS block in content.js: the only per-client change

> ### v2.3 REQUIRED, added 2026-08-11 after a data-integrity incident
> **`sellerUsername` is a fourth mandatory per-client value.** The extension verifies the
> Whatnot show host matches it before capturing anything, and **fails closed** if the handle
> is unset, the lookup fails, or the host differs. Without the gate, `liveId` comes from the
> URL, so every Whatnot live page the seller opens feeds their overlay and portal. Audit of
> one client: **89 of 112 shows belonged to other sellers, 4,613 foreign sales, about $249k
> of gross that was not theirs**, and board spots marking off while the client was offline.
>
> Two more v2.3 rules that must not regress:
> - **Team aliases match on word boundaries, minimum 3 characters.** The Oakland alias `"as"`
>   with a bare `includes()` made "PLEASE" and "MASTER" resolve to `OAK`, roughly 12,700 false
>   events across clients, 1,190 of them $0 giveaway items that burned a live board spot.
> - **One poller per show:** `window.__TSU_BRIDGE_ACTIVE__` single-instance guard plus a
>   `localStorage` lock keyed `tsu.pollLock.<liveId>`. Duplicate instances inflated sales up
>   to 5.7x.
>
> **Never ship an extension without running `node --check content.js`.** `extension-template/`
> was truncated mid-statement and unparsable until 2026-08-11; the working code had to be
> recovered from a client zip. Backup of the broken file: `content.js.TRUNCATED-backup-20260811`.

```js
// LOCKED, identical for every client. Do not change this per client.
const BRIDGE_URL = "https://bridge.tradesecretsunlocked.com";

// CHANGE PER CLIENT, only these four fields differ between clients.
const DEFAULTS = {
  bridgeKey:      "CLIENT-KEY-HERE",   // from Supabase bridge_keys, see §16
  sellerUsername: "client-handle",     // REQUIRED v2.3. Whatnot handle, lowercase, no @
  sport:          "nfl",               // "nfl" | "nba" | "mlb" | "nil"
  overlayId:      "client-handle",     // must equal the overlay's overlayId
  channel:      "main",
  pollMs:       3000,
  summaryEvery: 5
};
```

**Sport values**

| Value | Use when |
|---|---|
| `"nfl"` | Client only breaks NFL |
| `"nba"` | Client only breaks NBA |
| `"mlb"` | Client only breaks MLB |
| `"nil"` | Client breaks multiple sports, the extension infers sport from the listing title |

### isBadTitle: the slot-index guard is required

```js
function isBadTitle(t) {
  const raw = String(t || "").trim();
  if (!raw) return true;
  const s = raw.toLowerCase();
  if (s === "sale" || s === "—") return true;
  if (/^#?\d+$/.test(raw)) return true;   // REQUIRED: rejects "#3", "#15" slot subtitles
  const tail = stripPrefixTitle(raw);
  if (!tail || tail.toLowerCase() === "sale") return true;
  return false;
}
```

> **Why:** when `listing.title` is null on the first Whatnot GraphQL poll, the API falls back to `listing.subtitle`, which Whatnot auto-fills with the slot index (`"#3"`, `"#15"`). Without this guard the extension sends `code: ""` events that the overlay cannot resolve, and teams get silently dropped or misfired.
>
> The guard deliberately does **not** set `seen` for a bad title, so the item retries on the next poll once the real title loads.

### Loupe

Loupe is Firestore driven (project `loupe-1138`). A sale is an automated message in `sessions/{sessionId}/thread` carrying `senderName` (buyer), `itemName` (title), `itemId`, and `itemPriceCents` as an integer. The adapter maps this onto the same canonical `team_sold` bridge event, so **the overlay and the bridge are unchanged**. Full detail lives in `tsu-loupe-partnership/automation/loupe-automation-standard.md`.

---

## 8. Overlay Bridge Wiring

### Correct pattern: hardcoded constants

```js
const BRIDGE_BASE        = "https://bridge.tradesecretsunlocked.com";  // every overlay
const BRIDGE_KEY_DEFAULT = "CLIENT-KEY-HERE";  // same value as extension DEFAULTS.bridgeKey

function getParam(n){ return new URLSearchParams(location.search).get(n); }
function getBridgeBase(){ return (getParam("bridge") || BRIDGE_BASE).replace(/\/$/,""); }
function getBridgeKey(){  return getParam("key")     || BRIDGE_KEY_DEFAULT; }
function bridgeEnabled(){ return !!(getBridgeBase() && getBridgeKey()); }
```

> ⚠️ **Do not read the bridge URL or key from `localStorage` as the primary source.** An old session may hold a stale `tsu.bridgeUrl` pointing at a retired Render instance, and that value will silently win. Worse, a stale `tsu.key` makes the overlay join a **different client's** scope, which is the cross-client bleed bug in §20.
>
> `?bridge=` and `?key=` URL parameters are opt-in test overrides only. **Never put the bridge key in a URL as the deployment method.** Hardcode it in both the overlay and the extension.
>
> The row-grid family currently reads from localStorage first. That is legacy drift. New and edited builds hardcode.

### warmupPing: the correct endpoint

```js
function warmupPing(){
  fetch(`${getBridgeBase()}/events`, {
    method: "POST",
    headers: { "x-bridge-key": getBridgeKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "overlay_warmup", overlayId: "client-handle", channel: "main" })
  }).catch(() => {});
}
```

> ⚠️ Do not POST to `/warmup`. **That endpoint does not exist on the bridge.** Warmup is always `POST /events` with `type: "overlay_warmup"`.

Full endpoint list: `GET /stream`, `GET /events`, `GET /` all subscribe over SSE. `POST /events` and `POST /event` publish. `GET /health` and `GET /status?key=` report.

### SSE connection: the key must be in the query string

`EventSource` **cannot send custom request headers.** The bridge key cannot travel as `x-bridge-key` on an SSE connection, it must go in the URL as `&key=`.

```js
// CORRECT, key in the query string
const url = `${getBridgeBase()}/stream?channel=${encodeURIComponent(channel)}`
          + `&key=${encodeURIComponent(getBridgeKey())}`;
sse = new EventSource(url);

// WRONG, EventSource ignores headers and the bridge returns 401 "Missing bridge key"
sse = new EventSource(`${getBridgeBase()}/stream?channel=main`);
```

This applies to **both** connections: `connectBridgeSSE` (channel `main`) and `connectScoresSSE` (channel `sports`). Open one for each.

On `onerror`, close the connection and reconnect after 2500ms.

```js
// REQUIRED: named SSE events bypass onmessage, so listen for each type explicitly
["team_sold","team_unsold","buyer","reset","set_break","set_sport",
 "scores","stream_stats","whatnot_purchase","purchase"].forEach(t => {
  try { sse.addEventListener(t, ingest); } catch(_) {}
});
```

---

## 9. The Automation Contract

This is the part that breaks silently when it drifts. It must be identical in every build, in both families.

### 9.1 Events

**Extension to bridge** (`POST /events`, header `x-bridge-key`, legacy `x-api-key` and `Bearer` still accepted): `team_sold` (the sale), `team_unsold` (respin only), `stream_stats`, `overlay_warmup`.

**`team_sold` payload shape:**

```js
{ type, saleId, id, buyer, buyerName, title, amount, amountCents, currency,
  sport, code, teamCode, listingId, productId, liveId }
```

`code` equals `teamCode`. `saleId` equals `id`. Envelope fields common to all events: `type`, `overlay_id`, `channel`, `ts`, plus `breakId` where applicable. Event types are lower_snake_case, team codes are UPPERCASE, sports are lowercase.

**Bridge to overlay:** `hello` (ignore it), and `scores_update` on the sports channel for scores-entitled clients.

**The overlay must handle every alias:** `team_sold`, `sale`, `sold`, `purchase`, `whatnot_purchase` (all sale synonyms), `team_unsold`, `buyer` / `buyer_update`, `reset`, `set_break`, `set_sport`, `set_title`, `set_ticker`, `next_break`, `scores`, `stream_stats`, `overlay_warmup`.

SSE clients support `onmessage` plus named events, auto-reconnect at about 2.5s, ignore `hello`, tolerate malformed JSON, and never crash.

### 9.2 Code resolution, title to tile

1. `code = (payload.code || payload.teamCode).toUpperCase().trim()`, straight from the extension.
2. If empty, infer from `payload.title || itemTitle || listingTitle` through `inferTeamCodeFromTitle` (Divisions/Board) or `inferCodeFromTitle` (Row-grid).
3. **Divisions/Board only:** if `code` is not a board key, remap the team code to its group through `NFL_TEAM_TO_DIVISION` or `NBA_TEAM_TO_DIVISION`, built from `divisionCodes`. **This is how selling a team marks its division.**
4. Drop the event if there is still no code, or if `!boardState[code]`.
5. **The matcher rule, learned the hard way:** match incoming titles against the **active spot NAMES first**, longest name first, insensitive to case and punctuation, **before** any 2 to 4 character uppercase-token shortcut. A code shortcut that runs first will mis-grab words like "MISC" or "MAIN" and silently fail custom spots. Every custom-named spot must appear in the matchable entry list (`allEntriesForCurrentSport`).

### 9.3 Guards and dedup, both required

- **`breakIdMatches(data)` at the top of every handler.** `breakId` is `${yyyymmdd}-${breakType}-${breakNumber}`. No incoming `breakId` means pass, otherwise it must match. Required in every overlay. Some legacy files omit it, add it.
- **Dedup and respin key on `saleId || id || listingId`. Never on `productId`.** Keying on `productId` causes false unsolds, because one product spans many sales. When a key already maps to a *different* code, fire `sseMarkUnsold(prev)` before marking the new code sold.
- **The dedup key must be unique per SPOT, not per listing and not per buyer.** This rule was already written as "never `productId`", and the same class of bug still shipped, so state it positively: a break is **one listing that the same buyer wins many times**. Any key built only from listing and/or buyer identity collapses every spot that buyer took onto a single value. Each new win then reads as the previous item re-resolving to a different team, the code-changed branch fires, and the extension emits `team_unsold` for a spot the buyer had already won. **Live incident 2026-08-15 (Breakz4Dayz):** `stableId()` fell back to `${listingId}_${buyerId}`, one buyer took `CUSTOM_001`, then `HOU`, then `IND`, and each new win released the one before it. A sweep of `bridge_events` found the same signature across **12+ clients**, led by Northland Breaks with 43,283 affected sale IDs and Legends Hobby with 21,330.
  - **Acceptable key:** the platform's own per-sale id when present, otherwise a composite that includes something that actually varies per spot, such as the spot **title** and **price**.
  - **Never acceptable:** `productId`; `listingId` alone; `buyerId` alone; `listingId + buyerId`.
  - **Two-sided test any key must pass, both halves required:** (a) three different spots won by the SAME buyer in the SAME break produce three DIFFERENT keys, and (b) the SAME spot re-read on the next poll produces the SAME key. Half a test is how this shipped: passing only (b) looks like working dedup while silently unselling spots.
- **Buyer uniqueness: RETIRED 2026-08-21. Do not implement it. Remove it wherever it still exists.**
  Earlier versions of this section required: *"Before assigning a buyer to a new team, unsell any team that buyer already owns. This prevents a double-sold tile."* **That rule was wrong and it corrupted live breaks.**
  - **What it actually did.** One buyer routinely wins several spots in a single break. Releasing their previous tile put an already-sold spot back on the board, on stream, mid-break, and dropped that sale from the sold list and therefore from the CSV export.
  - **Live incident 2026-08-21 (Bigger Than Cardboard).** Three consecutive NFL breaks, each a full 32-team sellout. All 96 sales carried DISTINCT sale ids, so dedup was working perfectly and this rule alone caused the damage. The boards finished showing **13, 10 and 12** tiles instead of 32, and **61 spots were wrongly put back**. One buyer took 20 teams in a single break; every win after their first released the one before it. The seller's export held 35 of 96 rows.
  - **It never prevented anything.** A double-sold TILE means two buyers on ONE tile. That is a different failure, and it is already handled correctly by the sale-id reassignment rule above, which releases only the tile that genuinely moved. Buyer uniqueness could only ever fire on sales that were genuinely separate, so **every time it fired it was wrong**.
  - **The correct rule: a buyer may hold as many tiles as they win.** Nothing about a repeat buyer is an error. Only a sale id re-resolving to a different code releases a tile.
  - **Scoping it is not a fix.** It was scoped to team boards on 2026-08-10 on the reasoning that "on a random-team break one buyer holds one team". That premise is false for team breaks too, and the 08-21 incident is what proved it.

### 9.4 The four things that must match per client

1. Extension `DEFAULTS.bridgeKey` in `content.js`
2. Overlay `BRIDGE_KEY_DEFAULT` in `index.html`, equal to item 1
3. The Supabase `bridge_keys` row, with `active = true`
4. Extension `DEFAULTS.overlayId` equal to the overlay's `overlayId`

**Any one of these wrong and the client silently breaks.**

---

## 10. Overlay Automation Requirements

Every overlay MUST have these structures. Missing any one is a build failure.

### soldTeams and soldTeamsList

```js
const soldTeams = new Set();      // team codes currently sold
let soldTeamsList = [];           // [{code, buyer}], ordered, drives the sold panel
```

### The respin map

```js
const lastCodeByListingKey = new Map();  // saleId or id, mapped to the last team code
```

**Why:** when a buyer wins a respin, the host reuses the same `saleId`. The extension sends the new code, and the overlay must unsell the previous code before marking the new one. Without this map both the old and the new team show as sold. (Row-grid names the same map `lastCodeBySaleId`.)

### team_sold handler with reassignment

```js
if (data.type === "team_sold") {
  let code = getCodeFromPayload(data);
  if (!code) code = inferTeamCodeFromSaleTitle(data.title, currentBreakType);

  const listingKey = data.saleId || data.id || data.listingId || null;

  if (listingKey && code) {
    const prevCode = lastCodeByListingKey.get(listingKey);
    if (prevCode && prevCode !== code) {
      sseMarkUnsold(prevCode);    // auto-unsell the previous assignment
    }
    lastCodeByListingKey.set(listingKey, code);
  }

  if (code) sseMarkSold(code, buyer);
  return;
}
```

### State persistence

`loadSoldState()` plus a write to `<client>.soldState`, so an OBS refresh mid-break does not lose the board. Required for Tier 2 and above.

### overlayId

The `overlayId` in the overlay and in the extension DEFAULTS must be the identical string. The bridge uses it to route warmup pings.

---

## 11. Live Scores

> **CORRECTED IN 2.4.** Version 2.3 of this document instructed builders to return `` `sports-${SCORES_NAMESPACE}` `` from `getScoresChannel()` and explicitly labelled the bare string `"sports"` as "OLD / WRONG". **That was inverted.** Bare `"sports"` is correct. The rest of this section is the corrected rule plus the evidence, so this does not get flipped back.

### The rule, part 1: the CHANNEL

```js
function getScoresChannel(){ return "sports"; }
```

There is no per-client scores channel and no `SCORES_NAMESPACE` in a new build.

### The rule, part 2: the HOST (added 2026-08-12, this is the one that keeps biting)

**Scores do NOT come from the main bridge. They come from a separate service.**

```js
const BRIDGE_BASE        = "https://bridge.tradesecretsunlocked.com"; // sales, channel "main"
const SCORES_BRIDGE_BASE = "https://tsu-scores-bridge.onrender.com";  // scores, channel "sports"
```

```js
// sales  -> main bridge
connectBridgeSSE(`${BRIDGE_BASE}/stream?channel=main&key=${KEY}`);
// scores -> dedicated score service. NOT the main bridge base.
connectScoresSSE(`${SCORES_BRIDGE_BASE}/stream?channel=sports&key=${KEY}`);
```

Getting the channel right but the host wrong produces the exact failure this section
was written to prevent: the overlay connects, the connection stays open, no error is
logged anywhere, and **no scores ever arrive**. Doghouse Breaks lost scores this way,
and the fleet audit below shows it is the majority case, not an edge case.

Reference builds that are correct: `overlays/jp2-cards`, `overlays/quantum-breaks`,
`overlays/doghouse-breaks`.

### Why bare "sports" is correct

Isolation happens on the **bridge key**, not on the channel name (see §1). The bridge broadcasts scores inside each connected key's own bucket:

```js
// card-break-overlay/bridge/server.js
for (const [bridgeKey] of clients) {
  if (!scoresEnabledFor(bridgeKey)) continue;                       // reads client_services
  broadcast(bridgeKey, "sports", { type: "scores_update", ...payload });
}
```

So `channel = "sports"` is already per-client: a client only receives a `scores_update` if that client's own key is entitled in `client_services`. Naming the channel `sports-<slug>` did not add isolation, it just meant the overlay subscribed to a channel the bridge never broadcast on, so **no scores arrived at all**.

The fix is recorded in the code itself, in `overlays/jp2-cards/index.html`:

```js
function getScoresChannel(){
  // TSU 2026-05-21: bridge broadcasts ESPN scores to the plain "sports" channel
  // for every connected client. The previous per-client namespace ("sports-jp2-cards")
  // never matched the bridge's broadcast channel, so no scores arrived.
  return "sports";
}
```

Version 2.3 of this document is dated 2026-05-16, five days **before** that fix. That is why it had the rule backwards. Live code agrees with the fix: of the 19 overlays that wire scores, 17 return bare `"sports"` and zero return a `sports-<namespace>` template. The two that do not wire `getScoresChannel()` at all (`how-you-doin`, `southside-collects`) declare a leftover `SCORES_NAMESPACE` constant and never use it.

### SCORES_NAMESPACE is vestigial

Do not add `SCORES_NAMESPACE` to a new overlay. Where it still exists it is dead code and may be removed on the next edit.

`bridge_keys.namespace` in Supabase is a different thing and is still read, but only by `tsu-score-bridge` for its legacy per-client fan-out (see below). Setting it is harmless and optional. Nothing in a modern overlay depends on it.

### How scores flow, end to end

There are **two** score producers in the codebase. Both end up broadcasting on `"sports"`, which is why the current rule works either way.

```
ESPN public API (nfl, nba, mlb, nhl)
   │
   ├── path A, in-bridge (card-break-overlay/bridge/server.js)
   │     polls ESPN directly, gated by env ESPN_ENABLED (defaults to on unless
   │     explicitly set to "false"), skips entirely when nobody is listening
   │     per connected key: if scoresEnabledFor(key) then
   │        broadcast(key, "sports", { type:"scores_update", sport, games, ts })
   │
   └── path B, tsu-score-bridge (separate Render service)
         polls ESPN every 15s, reads client_services every 5 min
         POSTs { type:"scores", channel, sport, games } to the bridge /events, three ways:
            - per-client  channel: `sports-${client.namespace}`   LEGACY fan-out
            - global      channel: "sports"                        the live path
            - its own direct SSE broadcast                          backward compat
   ▼
bridge.tradesecretsunlocked.com, scoped per bridge key
   ▼
Overlay connectScoresSSE, channel "sports"
   ▼  normalizeScorePayloadToText()
SCORES_BY_SPORT["nba"] = "NBA: LAL 112-108 BOS (Final)"
   ▼  buildTickerLine()
ticker: [client text] • [NBA] • [client text] • [MLB] • [client text] • [NFL]
```

A client's overlay only shows scores when that client has `service = 'scores'` entitled and enabled in `client_services`. Toggling that row is the only control needed, no code change and no redeploy.

### RESOLVED 2026-08-12: which producer is actually running

The open item above is closed. Answer, with evidence from a live Render log plus the
deployed source:

- **Path A (in-bridge ESPN polling) is NOT deployed.** It exists only in
  `card-break-overlay/bridge/server.js`, which was last touched **2026-06-09** and is a
  stale copy. Do not read it to understand production. It is the file that says
  `type: "scores_update"`; nothing deployed emits that name. Treat that file as reference
  only until it is reconciled or deleted.
- **Path B (`tsu-score-bridge`) is the live producer.** It emits `type: "scores"`.
- **The deployed copy of Path B is itself stale.** The working tree at
  `tsu-score-bridge/server.js` contains a fix dated 2026-08-11 that has **never been
  committed or deployed** (last commit 2026-05-16). Production is still running the old
  templated fan-out:

  ```js
  await postToBridge(`sports-${client.namespace}`, sport, games);   // DEPLOYED, broken
  ```

  which is why a live log shows `ch=sports-crunchzone listeners=0`,
  `ch=sports-windy-city-breaks listeners=0`. No overlay subscribes to those names.
  The uncommitted fix posts per client on the bare channel, which is correct:

  ```js
  await postToBridge("sports", sport, games, client.key);           // LOCAL, correct
  ```

### The two ways an overlay can receive scores, and why it matters commercially

| Path | How | Works today | Entitlement gated |
|---|---|---|---|
| **Direct** | overlay connects to `tsu-scores-bridge.onrender.com/stream?channel=sports` | **Yes** | **NO** |
| **Relayed** | score service POSTs to the main bridge per client key, overlay listens on main bridge `channel=sports` | Not until the fix above is deployed | Yes, via `client_services` |

**Read the "NO" carefully.** `tsu-score-bridge`'s `/stream` endpoint performs no key check
and no entitlement lookup. It pushes every tick to every open connection:

```js
app.get("/stream", (req, res) => { clients.add(res); ... });   // no key, no gating
function broadcast(obj){ for (const res of clients) res.write(...); }
```

So the `key=` we pass on that URL is decorative today, and **anyone with the URL receives
scores whether or not they pay for them.** The direct path is the correct choice right now
because it is the only one that works, but it means scores are effectively ungated until
the relayed path is deployed. Do not price or promise scores as a gated upsell on the
strength of `client_services` alone until that is fixed.

### Overlay constants

```js
const BRIDGE_BASE        = "https://bridge.tradesecretsunlocked.com"; // sales
const SCORES_BRIDGE_BASE = "https://tsu-scores-bridge.onrender.com";  // scores
const BRIDGE_KEY_DEFAULT = "CLIENT-KEY-HERE";
// no SCORES_NAMESPACE
```

### Migrating an EXISTING client onto the current standard

Legacy clients were provisioned on a private `tsu-bridge-<client>.onrender.com` instance
and their OBS URL carries `?bridge=...`. Migrating them is not just a URL swap. Run every
step, in order. Doghouse Breaks 2026-08-12 is the worked example.

1. **Hardcode both hosts and the key in the overlay.** Do not leave them resolving from
   `localStorage` or a URL param. A legacy client has the old Render URL cached in the OBS
   browser source and a stale cached value silently wins over the new default.

   ```js
   function getBridgeUrl(){ const q=param("bridge"); return q ? clean(q) : BRIDGE_URL_DEFAULT; }
   function getBridgeKey(){ const q=param("key");    return q ? q       : BRIDGE_KEY_DEFAULT; }
   ```

2. **Add `&key=` to BOTH subscribe URLs.** A per-client bridge did not need a key because
   the whole instance was that client. The shared bridge is multi-tenant and a keyless
   subscribe gets nothing. Miss this on the scores connection only and sales work while
   scores are silently dead.

3. **Point the scores connection at `SCORES_BRIDGE_BASE`,** not at the main bridge base.
   See "The rule, part 2" above. This is the single most common migration miss.

4. **Entitle the service:** `client_services` row for `service='scores'` with **both**
   `entitled = true` and `enabled = true`. Either one false means no scores.

5. **Register the client's real bridge key in `bridge_keys`** and confirm `active = true`.
   Legacy extensions often carry a key that was only ever valid on the private instance and
   does not exist in `bridge_keys` at all. The shared bridge returns 403 for it. Doghouse's
   old extension was sending `15a65c6691a5d5fb0fd781af0a06dfc4`, which matched no row.

6. **Rebuild the extension** from the current v2.2 template with the correct key baked in.
   Have the client REMOVE the old extension rather than disable it, so two copies cannot
   both post.

7. **Set `bridge_keys.whatnot_handle`.**

8. **Portal:** entitle `portal`, then after the client signs in once, link their
   `auth.users.id` into `client_users`. The row cannot be created before their first login.

9. **Give them a clean OBS URL with no query string,** and tell them to replace the URL
   rather than refresh. A refresh keeps the old `?bridge=` override.

10. **Verify, do not assume.** Two independent checks:

    ```sql
    -- sales are arriving
    select event_type, count(*), max(occurred_at) from bridge_events
    where bridge_key = '<key>' and occurred_at > now() - interval '1 hour'
    group by event_type;
    ```

    Scores can NOT be verified this way. `NO_LOG_EVENT_TYPES` on the bridge deliberately
    excludes `scores` and `stream_stats`, so they never appear in `bridge_events` and an
    empty result proves nothing. Verify scores in the client's browser instead: DevTools,
    Network, filter `stream`, confirm an open connection to
    `tsu-scores-bridge.onrender.com/stream?channel=sports`.

    Seasonality caveat: if ESPN returns no games for a sport, nothing renders and that is
    correct. Judge only against a sport with live games that day.

### Scores feature flag

```js
// On by default in the overlay. Disable overlay-side with ?scores=0 in the OBS URL.
// The real per-client control is Supabase client_services, see §12.
const ENABLE_SCORES = (getParam("scores") === null) ? true : (getParam("scores") === "1");
```

### Freshness guard, 20 minute window

```js
const SCORES_BY_SPORT   = { nba: "", nfl: "", mlb: "" };
const SCORES_UPDATED_AT = { nba: 0,  nfl: 0,  mlb: 0 };

function isFreshSportScore(sport){
  return (Date.now() - (SCORES_UPDATED_AT[sport] || 0)) < 1000 * 60 * 20;
}
```

Scores older than 20 minutes are dropped from the ticker, so stale game data does not linger when no games are in progress.

### Ticker interleave

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

Output pattern: `[client] • [NBA] • [client] • [MLB] • [client] • [NFL]`.

### Accepted score payload formats

`normalizeScorePayloadToText()` handles all three. Note that `channel` is `"sports"` in every case.

```js
// Format 1, pre-formatted text string, the simplest
{ type: "scores", channel: "sports", sport: "nba", text: "NBA: LAL 112-108 BOS (Final)" }

// Format 2, games array, what both producers actually send
{ type: "scores", channel: "sports", sport: "nba",
  games: [{ away:"LAL", awayScore:112, home:"BOS", homeScore:108, status:"Final" }] }

// Format 3, lines array
{ type: "scores", channel: "sports", sport: "nba", lines: ["LAL 112-108 BOS"] }
```

The in-bridge producer sends `type: "scores_update"` with the same `games` shape, which is why `scores_update` must be in the handled alias list.

---
## 12. Per-Client Services

Every optional feature is toggled per client in Supabase. No code change, no redeploy, no file edit. This is the control surface for scores, automation, hosting and everything added later.

### The two booleans

`client_services` has **two** flags and they mean different things:

| Column | Meaning |
|---|---|
| `entitled` | The client has access to this feature, because they paid for it or it was granted. Only an admin sets this. |
| `enabled` | The feature is currently switched on. |

**A feature is active only when `entitled AND enabled` are both true.** This trips people up constantly. A client can be entitled to scores and have them switched off, or be entitled and on. A client who is enabled but not entitled gets nothing, and `toggle-feature` will refuse with `403 code:"upgrade"`.

### Schema

```sql
CREATE TABLE client_services (
  key        TEXT        NOT NULL REFERENCES bridge_keys(key) ON DELETE CASCADE,
  service    TEXT        NOT NULL REFERENCES service_catalog(service),
  entitled   BOOLEAN     NOT NULL DEFAULT false,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, service)
);
```

`service_catalog` is the allow list. A `service` value that is not in the catalog cannot be inserted.

```sql
-- service_catalog: service, label, description, default_enabled, sort_order, self_serviceable
```

`self_serviceable` decides who may flip `enabled`:

| `self_serviceable` | Services | Who can toggle |
|---|---|---|
| `true` | `scores`, `chatbot` | The seller, from their portal, if entitled |
| `false` | `automation`, `hosting`, `analytics`, `portal` | Staff only, managed |

The six services above are the documented set. The live `service_catalog` table currently holds ten rows, so **query the catalog rather than trusting this list** when you need the current set:

```sql
SELECT service, label, self_serviceable, default_enabled FROM service_catalog ORDER BY sort_order;
```

### Turning a service on or off

```sql
-- Grant access (admin only, this is the paid entitlement)
INSERT INTO client_services (key, service, entitled, enabled)
VALUES ('CLIENT-UUID-HERE', 'scores', true, true)
ON CONFLICT (key, service)
DO UPDATE SET entitled = true, enabled = true, updated_at = now();

-- Switch off without removing access
UPDATE client_services
SET enabled = false, updated_at = now()
WHERE key = 'CLIENT-UUID-HERE' AND service = 'scores';

-- Revoke access entirely
UPDATE client_services
SET entitled = false, enabled = false, updated_at = now()
WHERE key = 'CLIENT-UUID-HERE' AND service = 'scores';
```

Effect is near immediate for the in-bridge score path (the bridge caches the enabled-key set) and within about five minutes for `tsu-score-bridge`, which re-reads the table on a timer. Never more than five minutes either way.

### Do not write these rows by hand for a new client

`provision-client` writes them for you, with `entitled: true` and `enabled: true`, for every feature passed in. Hand SQL is the fallback for repairs and for legacy keys. See §16 and the provisioning SOP.

### tsu-score-bridge Render env vars

Only relevant if Path B in §11 is the producer still running.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://znyryhgjghjsobkzyfbx.supabase.co` |
| `SUPABASE_KEY` | Service role key. Not the anon key, it needs table read access. |
| `BRIDGE_KEY` | Any valid active key from `bridge_keys`, used to authenticate its own score POSTs |

If `SUPABASE_URL` or `SUPABASE_KEY` is missing the service logs `[supabase] SUPABASE_URL/KEY not set` and falls back to broadcasting on the global `sports` channel only. Because bare `sports` is the correct channel (§11), that fallback still works. It just loses the per-client gating, so every connected overlay gets scores regardless of entitlement.

After changing env vars, trigger a manual redeploy in Render. `GET /status` on the score-bridge returns which clients it currently considers enabled.

---

## 13. Sold Panel: The Correct Pattern

The sold panel is the single most common source of client complaints, and it is always the same root cause. Read this section before touching `updateSoldList`.

### updateSoldList: incremental patch, never an innerHTML wipe

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

> ⚠️ **Never use `soldListDiv.innerHTML = ""` in `updateSoldList`.** Every call destroys active inputs, clears text the seller is mid-way through typing, and produces the visible flash-and-reset that clients report as "the overlay glitched". The function above is called on every single bridge event, so it must be cheap and non-destructive.

Two rules follow from that, and they are both load bearing:

1. **Key rows by `data-code`.** That is what makes add, remove and update decidable without a rebuild.
2. **Never overwrite a focused input.** `document.activeElement !== input` is the guard. Without it, a `team_sold` arriving while the seller types a buyer name wipes what they typed.

---

## 14. Required UI

Every build ships with all of the following. These are not per-client options.

### Always visible, never inside a modal

- **Reset**
- **New Break**
- **Sold** stat, where clicking it toggles the admin button row
- **Remaining** stat

### Inside the sold panel

Sport switcher, chase selector if the break uses one, export or copy of the sold list, SSE connection status, and any secondary admin controls.

**Density rule: extra controls go into the sold panel or the header. Never into the grid.** The grid is the thing on camera. Adding controls to it is how layouts break.

### Minimum modals

Ticker editor with text and speed, title editor, break-number editor, and the export or copy modal. All four use the OBS-safe modal pattern. **Never `prompt()` and never `alert()`**, because they block the OBS browser source thread and there is no way for the seller to dismiss them.

### Always-on visuals

- **`soldFlash` on every sale.** Required in every build. `barn-breaks` is missing the rich FX layer, so do not copy that gap forward (§21).
- **Image fallback.** `img.onerror` swaps in `.fallback-code` showing the team code as text, so a missing logo never leaves an empty tile.
- **Hover and sold tile states.**

### State persistence

`loadSoldState()` on load, and persist to `<client>.soldState` on every mutation, so an OBS refresh mid-break does not lose the board. Required for Tier 2 and above. See §4 for the localStorage key convention.

---

## 15. Stability Rules

These are the heuristics that prevent rework. They have all been learned the expensive way.

**Stability beats density.** Grid row and column counts do not change at runtime, ever. Optional features (named spots, chase tiles, premium boards) must be isolated, fully removable, and must not mutate the core primitives. If a feature needs the grid to reflow, the feature is wrong.

**Surface edits only when cloning.** What a clone is allowed to change: colors, logo, brand text, ticker and title defaults, the per-client bridge key, and named spots. What it must not change: sections, grid math, the function set, and any SSE or automation logic. See §2 and Rule #1.

**Visible color contrast in every build.** No flat single-color designs. Use gradients deliberately to draw the eye to the header, the ticker and the sold panel.

**Animations signal state change only.** A sale flashes. A reassignment flashes. Nothing animates just to be pretty in the middle of a break. Ambient border effects (the `wickRun` keyframe plus `.wick`) are the exception and need no cooldown because they carry no meaning. Audio is opt-in and off by default.

**Never modify automation code during a clone build.** If the automation needs a change, that is a separate, deliberate, tested change made to the canonical reference and then propagated. Not something done in passing while restyling a client overlay.

---

## 16. Supabase: New Client Key

### The automated path, which is the normal path

`provision-client` (deployed v8, `verify_jwt: true`, admin-gated through `app_admins`) does all of this in one call: generates the UUID, upserts `bridge_keys` **with `client_email`**, upserts `client_services` with `entitled: true` and `enabled: true` for every requested feature, and validates the feature list against `service_catalog`.

Defaults it applies: `features` defaults to `["hosting","automation"]`, `key` defaults to `crypto.randomUUID()` unless a `bridge_key` is passed in, valid tiers are `local`, `pro`, `elite`, `custom`, `legacy`, and `status` resolves to `grandfathered` when flagged, else `active` when `monthly_amount > 0`, else `none`.

**Use it.** Hand SQL below is for repairs, legacy keys and offline work.

### Generate a UUID by hand

```powershell
[System.Guid]::NewGuid().ToString()
```

Example output: `5d74ccce-d801-4064-8095-5428b6e7598e`.

Legacy 32-character hex keys are also valid and still in service. Both formats work. New keys are UUIDs.

### Manual new-client SQL

```sql
-- Step 1: the bridge key. client_email is NOT optional, see the warning below.
INSERT INTO bridge_keys (key, client_name, client_email, namespace, notes)
VALUES (
  'GENERATED-UUID-HERE',
  'Client Name',
  'client@example.com',     -- feeds the portal auto-link trigger
  'client-handle',          -- URL-safe slug, only tsu-score-bridge legacy fan-out reads this
  'client-handle overlay'
)
ON CONFLICT (key) DO NOTHING;

-- Step 2: entitlements. BOTH booleans, see §12.
INSERT INTO client_services (key, service, entitled, enabled) VALUES
  ('GENERATED-UUID-HERE', 'hosting',    true, true),
  ('GENERATED-UUID-HERE', 'automation', true, true),
  ('GENERATED-UUID-HERE', 'scores',     true, true)
ON CONFLICT (key, service)
DO UPDATE SET entitled = true, enabled = true, updated_at = now();
```

> ⛔ **`client_email` is load bearing.** A database trigger consumes it to link the seller's portal login to this client automatically on their first sign-in. Omit it and the client provisions "successfully", the overlay works, and then the seller signs in to the portal and sees nothing, because no `client_users` row was ever created. This is the single most recurring provisioning bug in TSU's history. It is also why the stale repo copy of `provision-client` is a live hazard (§21.1).

> Setting `entitled` without `enabled`, or `enabled` without `entitled`, silently half-provisions the client. Always write both.

### bridge_keys schema

```sql
CREATE TABLE bridge_keys (
  key              TEXT        PRIMARY KEY,
  client_name      TEXT        NOT NULL,
  client_email     TEXT,                          -- portal auto-link trigger input, always set it
  owner_contact_id UUID,                          -- FK to crm_contacts, links key to the CRM record
  namespace        TEXT,                          -- slug, legacy tsu-score-bridge fan-out only
  active           BOOLEAN     NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`active = false` is how a key is revoked. The bridge returns **403** for a key that is missing from the table or inactive, and **401** when no key was presented at all. Do not delete rows to revoke, set `active = false`, so the history in `bridge_events` stays interpretable.

### Revoking a key without leaving an OBS source 403-looping

When a client leaves, their OBS scene may still be pointed at the overlay somewhere. Add the revoked key to `QUIET_SUBSCRIBE_KEYS` in the bridge source. A listed key's SSE **GET** is accepted as an idle connection that receives zero events, while **POST is still 403'd**. The abandoned source connects, sits quiet, and stops hammering the logs. The key is still revoked in every way that matters.

---

## 17. Custom Outliers: Never Clone These

These files solve specific problems well. Read them to lift a single technique. **Never start a build from one.**

**`jim-and-tabby`.** Combo envelope plus chaser break. Its `inferTeamCodeFromTitle` is layout-aware and uses `labelMatches()`, a digit-boundary-safe contains, plus a longest-label-first sort, so "Chaser 1" does not match "Chaser 10". That technique is worth stealing. Automation is currently off, rebuild in progress, and its key `469c3440...` sits in the bridge's `QUIET_SUBSCRIBE_KEYS`. *Latent bug: its `nfl-nba` branch still uses the old `raw.includes()` and was never converted. Do not propagate that branch.*

**`bird-dogz-breaks`.** Webcam-frame layout, meaning cam plus side panel plus bottom strip. Entirely different `:root` and structure, shares none of the family conventions.

**`southside-collects` and `hoovs`.** Older flat-grid generation. Lowercase `breakTypes`, no `boardState`, no division mapping, no `breakIdMatches`, and `tsu.` prefixed storage via `getStateKey()`. Functional but pre-standard. Both also carry a dead `SCORES_NAMESPACE`.

**`deathstar`** (dual-theme tiles), **`klutch-bros`** and **`pack-smashers`** (center promo slot), and the three-column-cam builds **`thehitchasers`** and **score-more**. Specialty layouts. Use `references/feature-registry.md` to lift the one feature you want, not the whole file.

**`archived/extension/`.** The one extension folder that must never be used as a template. It is the only place still carrying the legacy `https://*.onrender.com/*` host permission.

---

## 18. Deploy Checklist

Work top to bottom. Every line has cost somebody a broken client at least once.

### Supabase

- [ ] Provision through `provision-client` if at all possible, not by hand
- [ ] If by hand: generate UUID (`[System.Guid]::NewGuid().ToString()`)
- [ ] `bridge_keys` row exists with `key`, `client_name` and **`client_email`**
- [ ] `client_services` rows exist with **both** `entitled = true` and `enabled = true` for each feature
- [ ] `active = true` on the `bridge_keys` row

### Extension

- [ ] Copy the current extension template folder, never `archived/extension/`
- [ ] Update `content.js` `DEFAULTS`: `bridgeKey`, `sport`, `overlayId`
- [ ] Confirm `manifest.json` has `https://bridge.tradesecretsunlocked.com/*` in `host_permissions`
- [ ] Confirm `manifest.json` has NO `*.onrender.com` entries
- [ ] Confirm `content.js` `isBadTitle` includes the `/^#?\d+$/` slot-index guard

### Overlay

- [ ] Started from a canonical reference for the correct family (§2), not from scratch
- [ ] `BRIDGE_BASE` and `BRIDGE_KEY_DEFAULT` hardcoded as constants
- [ ] `getScoresChannel()` returns the bare string `"sports"` **(corrected in 2.4, see §11)**
- [ ] No `SCORES_NAMESPACE` constant added
- [ ] `getBridgeBase()` does NOT read localStorage as its primary source
- [ ] `getBridgeKey()` does NOT read localStorage as its primary source
- [ ] `warmupPing` POSTs to `/events` with `type:"overlay_warmup"`, not to `/warmup`
- [ ] `overlayId` in the overlay matches `DEFAULTS.overlayId` in the extension
- [ ] `soldTeams` Set present
- [ ] `soldTeamsList` array present
- [ ] `lastCodeByListingKey` Map present
- [ ] `breakIdMatches(data)` guard on every SSE event handler
- [ ] `updateSoldList()` does NOT use `innerHTML = ""`
- [ ] Both SSE URLs include `&key=${encodeURIComponent(getBridgeKey())}`
- [ ] `--primary` and `--secondary` declared at `:root` and aliased onto the family vars (§5)
- [ ] Visible color contrast, no flat single-color design
- [ ] Required UI all present and visible (§14)
- [ ] Staged to `_drafts/<client>/index.html` for Mike's review
- [ ] Mike promotes `_drafts/` to `overlays/<client>/index.html`

### Live

- [ ] Client installs the extension: remove the old one, then `chrome://extensions`, Load unpacked, select the new folder, toggle on
- [ ] Overlay loaded as an OBS browser source
- [ ] SSE connected, no 401s and no 403s in the DevTools Network tab
- [ ] A test sale marks the correct tile
- [ ] If scores are entitled: ticker shows scores within roughly 15 seconds
- [ ] No server redeploy needed. The bridge is shared and always on.

### Extension reinstall steps, client facing

1. Open Chrome and go to `chrome://extensions`
2. Find the old TSU Bridge extension and click **Remove**
3. Click **Load unpacked**
4. Select the new extension folder
5. Toggle the extension **on**
6. Open the Whatnot or Loupe live page and confirm the console shows `[TSU] Bridge: https://bridge.tradesecretsunlocked.com`

---

## 19. Validation Checklist

Run every one of these before marking an overlay ready for review. Most are a single grep.

| Check | What to verify |
|---|---|
| `soldTeams` Set | `const soldTeams = new Set()` present in the STATE section |
| `soldTeamsList` array | `let soldTeamsList = []` present |
| `lastCodeByListingKey` Map | `const lastCodeByListingKey = new Map()` present |
| Bridge constants | `BRIDGE_BASE` and `BRIDGE_KEY_DEFAULT` both hardcoded |
| `getBridgeBase()` | Returns URL param OR hardcoded constant. No localStorage lookup. |
| `getBridgeKey()` | Returns URL param OR hardcoded constant. No localStorage lookup. |
| `bridgeEnabled()` | Checks both `getBridgeBase()` AND `getBridgeKey()` |
| `getScoresChannel()` | Returns the bare string `"sports"`. **Corrected in 2.4.** A `sports-<namespace>` template is wrong and receives nothing. |
| `SCORES_NAMESPACE` | Search for it. Should return 0 results in a new build. |
| `warmupPing` endpoint | POSTs to `/events`, not `/warmup` |
| SSE key in URL | Both `connectBridgeSSE` and `connectScoresSSE` URLs include `&key=${encodeURIComponent(getBridgeKey())}`. EventSource cannot send headers. |
| SSE named listeners | All handled types registered, including `team_sold`, `team_unsold`, `buyer`, `scores`, `scores_update` |
| `breakIdMatches` | Present, and called at the top of every SSE event handler |
| Dedup key | Keyed on `saleId || id || listingId`. **Never `productId`.** |
| Dedup key uniqueness | Key varies per SPOT. **Never** `listingId + buyerId` or either alone. Run the two-sided test in §9.3: same buyer + three spots gives three keys, and a re-poll of one spot gives the same key. |
| `team_sold` handler | Includes the `lastCodeByListingKey` reassignment check |
| Buyer uniqueness ABSENT | **Retired 2026-08-21.** Grep for `buyer uniqueness` and `BUYER_UNIQUENESS`. Any code that unsells a tile because the same buyer won another one must be removed. A buyer may hold as many tiles as they win. See §9.3. |
| `overlayId` match | The overlay's `overlayId` string equals the extension's `DEFAULTS.overlayId` |
| No deprecated `scoresChannel` | Search for `scoresChannel`. Must return 0 results. |
| `ENABLE_SCORES` | Present, reads the `?scores=` param, defaults on |
| `isFreshSportScore` | 20 minute freshness window |
| `updateSoldList` | Incremental patch. Does NOT use `innerHTML = ""`. Skips focused inputs. |
| `soldFlash` | Present and firing on sale |
| Image fallback | `img.onerror` falls back to `.fallback-code` |
| `loadSoldState()` | Present, with a per-client localStorage prefix |
| No stale Render URLs | Search for `onrender.com` in the overlay. Must return 0 results. |
| No `prompt()` or `alert()` | Search for both. Must return 0 results. |
| `--primary` / `--secondary` | Declared at `:root`, aliased onto the family accent and bg vars |
| Required UI | Reset, New Break, Sold stat, Remaining stat all visible without opening anything |
| manifest `host_permissions` | Includes `bridge.tradesecretsunlocked.com/*`, no `onrender.com` |
| `isBadTitle` in extension | Includes the `/^#?\d+$/` guard |
| Supabase `client_services` | Rows exist for this key with `entitled = true` and `enabled = true` |
| Supabase `bridge_keys` | Row exists, `active = true`, `client_email` populated |

---

### Added 2026-08-18 — gates that would have caught live faults

| Check | Command | Expected |
|---|---|---|
| Overlay script parses | extract the inline `<script>`, `node --check` | exit 0. A syntax error kills the WHOLE overlay |
| Scores host is the dedicated service | `grep -c 'tsu-scores-bridge' index.html` | `1` if scores are wired |
| No other Render host | `grep -c 'onrender.com' index.html` | `1`, and it is the line above |
| Scores event aliases | `grep -c 'scores_update' index.html` | `>=1`, registered AND handled alongside `scores` |
| Layout rule cannot leak to the banner | `grep -c '\.overlay > \.main' index.html` | `1` in any sms-derived file. See §20 |
| Dedup key is per-SPOT | read `stableId()` in the client's `content.js` | must NOT be listing id, buyer id, or the two joined |
| Deployed file matches local | `diff overlays/<c>/git-index.html overlays/<c>/index.html` | no unexplained differences |
| No external asset hosts | `grep -c 'supabase.co/storage' index.html` | **0**. Every asset resolves through `BASE` |
| Client logo is in the repo | `grep -n 'LOGO_PATH' index.html` | `` `${BASE}images/logos/<slug>-logo.png` `` |


## 20. Known Bugs and Anti-Patterns

| Bug | Symptom | Root cause | Fix |
|---|---|---|---|
| Bridge POSTs silently fail | Teams sell on Whatnot but never appear on the overlay | `bridge.tradesecretsunlocked.com` missing from `manifest.json` `host_permissions` | Add the bridge domain to `host_permissions` |
| Stale Render URL overrides bridge | Overlay connects to the wrong bridge, gets 404s | `getBridgeBase()` reads localStorage first, and an old session holds a retired Render URL | Hardcode `BRIDGE_BASE`, bypass localStorage |
| `#3` slot titles fire `code:""` | Wrong team marked first, nothing works afterwards | Whatnot returns `listing.title = null` on the first poll and the code falls back to the slot subtitle `"#3"` | Add the `/^#?\d+$/` guard to `isBadTitle` |
| `warmupPing` gets 404 | Console shows bridge POST errors on load | POSTing to `/warmup`, which does not exist | POST `/events` with `type:"overlay_warmup"` |
| `overlayId` mismatch | Bridge warmup routing broken | Extension and overlay carry different `overlayId` strings | Set both to the same value |
| Sold panel resets or glitches | Panel flashes, buyer inputs clear while the seller types | `updateSoldList()` uses `innerHTML = ""`, rebuilding the whole DOM on every event | Patch incrementally, add, remove and update rows, skip focused inputs (§13) |
| Teams past slot 24 never sell | The first 24 slots work, the rest are silently dropped | The extension sent `after: null` on every request, so it only ever fetched page 1 | v2.2 pagination, loop all pages up to `MAX_PAGES = 12` |
| Lost events on a network blip | The break has gaps even though the sales show in Whatnot | The old extension set `seen` before confirming the bridge POST | Only set `seen` after a successful `sendEvent()` |
| Duplicate `team_sold` on a respin | Both the old and the new team show sold | No reassignment tracking | `lastCodeByListingKey`, unsell the previous code when the same `saleId` returns a different code |
| False unsolds across a break | Teams randomly clear | Dedup keyed on `productId`, which is the break, not the sale | Key on `saleId \|\| id \|\| listingId` |
| Extension silently 401s all session | No sales ever appear | `bridgeKey` left as a placeholder in `DEFAULTS` | The extension now fails fast with a console error when `bridgeKey` is missing |
| SSE 401 "Missing bridge key" | Every `/stream` connection returns 401, the overlay receives nothing | `EventSource` does not support custom headers, so `x-bridge-key` is ignored on SSE | Append `&key=${encodeURIComponent(getBridgeKey())}` to both SSE URLs |
| SSE 403 on every reconnect | Overlay loops, logs fill up | The key is not in `bridge_keys`, or `active = false` | Fix the key, or if it is intentionally revoked add it to `QUIET_SUBSCRIBE_KEYS` (§16) |
| Scores never appear, no 401 | SSE connects, ticker never shows a score | The client is not entitled, or is entitled but not enabled, in `client_services` | Set both booleans true (§12). Then confirm which score producer is live (§11). |
| **Scores wired to a per-client channel receive nothing** | Ticker stays on client text forever, no errors anywhere | `getScoresChannel()` returns `` `sports-${SCORES_NAMESPACE}` ``. The bridge broadcasts on bare `"sports"`, scoped per bridge key, so the per-client channel name matches nothing. **v2.3 of this document told people to do this.** | Return the bare string `"sports"` (§11) |
| A revoked client still gets scores | An overlay that should be dark still updates | `tsu-score-bridge` is running without `SUPABASE_URL`/`SUPABASE_KEY`, so it broadcasts globally with no entitlement gating | Set its env vars and redeploy, or retire it in favour of the in-bridge producer (§11) |
| Another stream's sales bleed onto the board | Tiles get marked and unmarked by a different client's events | The bridge base or key was read from localStorage as primary, and/or an SSE URL had no `&key=`, so the overlay joined the wrong scope | Hardcode `BRIDGE_BASE` and `BRIDGE_KEY_DEFAULT`, always append `&key=` to every SSE URL including scores. Never localStorage-primary. (`southside-collects` and the `sms` source class, `overlays/sms` patched 2026-06-20.) |
| Provisioned client cannot see anything in the portal | Overlay works, automation works, portal is empty | `bridge_keys.client_email` was never set, so the auto-link trigger never created the `client_users` row | Set `client_email`, then have the seller sign in again (§16) |
| Every feature 403s with `code:"upgrade"` | `toggle-feature` refuses everything | Rows were written with `enabled` but not `entitled` | Set `entitled = true` (§12) |

---

### The `.main` class collision (sms-derived files) — added 2026-08-18

In the sms family the layout container is `<div class="main">` **and** the promo banner's
message div built in `renderBanner()` is also `class="main"`. An unscoped rule:

```css
.main{ display:grid; grid-template-columns: var(--sideW) 1fr var(--sideW); }
```

therefore applies to every banner message, rendering it inside the 255px first grid column.
`text-align:center` then centres the text **in that column**, not in the banner. The symptom is
banner text that looks off-centre and appears to drift with message length, and it cannot be
fixed from the banner CSS.

**Fix:** scope the layout rule to `.overlay > .main`, reset `display/grid/gap/margin` on
`.banner-text .main`, and scope any `document.querySelector('.main')` the same way.

**Present in `overlays/sms` and every clone of it.** Fixed so far in `heatcheckcards` and
`tyschap-breakz`. Not yet swept across the rest.

### Destructive image fallback — added 2026-08-18

`img.onerror = () => { d.textContent = team.code; }` wipes **every child** of the tile, including
the `.fx` layer and any `.chaseTag`. A team whose logo 404s silently loses its chaser badge and
CHASE tag. §14 requires a `.fallback-code` child element instead. Present in `blue-light-rips`.


## 21. Known Drift Still Open

Recorded so the canon stays honest. Each of these is a real inconsistency between the documented standard and something live.

### 21.1 The repo copy of `provision-client` is stale and dangerous

The deployed function (v8) is correct. The repo copy at `card-break-overlay/supabase/functions/provision-client/index.ts` is not. Two lines differ:

```js
// DEPLOYED v8, correct
await svc.from("bridge_keys").upsert({ key, client_name, client_email: email, active: true }, { onConflict: "key" });
await svc.from("client_services").upsert(features.map(service => ({ key, service, entitled: true, enabled: true })), { onConflict: "key,service" });

// REPO COPY, stale
await svc.from("bridge_keys").upsert({ key, client_name, active: true }, { onConflict: "key" });
await svc.from("client_services").upsert(features.map(service => ({ key, service, enabled: true })), { onConflict: "key,service" });
```

The repo copy drops `client_email` and drops `entitled: true`. **Deploying from the repo reintroduces the number one recurring provisioning bug and simultaneously breaks every entitlement.** Two decisions are needed from the owner: either sync the repo file from the deployed source, or stop deploying this function from the repo and treat the deployed version as the only copy. Until one of those happens, do not redeploy `provision-client`.

### 21.2 Row-grid family reads bridge config from localStorage first

The row-grid family still resolves the bridge URL and key from localStorage before falling back to constants. The divisions family hardcodes correctly (§8). This is the mechanism behind the cross-client bleed bug. Fix the row-grid canonical reference, then propagate.

### 21.3 `breakIdMatches` missing in the row-grid family

Missing in row-grid and in the flat-grid outliers (`southside-collects`, `hoovs`). It should be present in every overlay and called at the top of every SSE handler (§9).

### 21.4 `barn-breaks` has no `soldFxLayer`

`soldFlash` is required in every build (§14). `barn-breaks` lacks the `soldFxLayer` and `playSoldAnimation` rich flash that `legends` and `midwest` have. Backport it, and do not clone `barn-breaks` in the meantime.

### 21.5 Which score producer is actually running

Two ESPN score producers exist in the codebase (§11). Both broadcast on `"sports"`, so overlays work either way, but only one should be paying for the polling. Needs a Render check: is `ESPN_ENABLED` set on the bridge service, and is `tsu-score-bridge` still deployed. Resolving this also closes `TSU-MEMORY.md` §7.6.

### 21.6 The 43 localStorage-primary overlays

Known and accepted. Per the owner, these are outdated and will either fall off as clients churn or be migrated when they are next touched. **No remediation project.** Do not clone them, and fix the pattern in any file you open for other reasons.

---

## 22. Quick Reference: Per-Client Diff

When building a new client overlay, this is the complete list of things that change. Anything else you find yourself editing means you are off the standard, so stop and check §2.

**Supabase, one time, preferably through `provision-client`:**

```
bridge_keys.key           → new UUID
bridge_keys.client_name   → "Client Name"
bridge_keys.client_email  → seller's email        (portal auto-link, do not skip)
bridge_keys.active        → true
client_services rows      → (key, service, entitled=true, enabled=true) per feature
```

**Extension `content.js` DEFAULTS:**

```
bridgeKey  → the UUID from bridge_keys
sport      → "nfl" | "nba" | "mlb" | "nil"
overlayId  → "client-handle"
```

**Overlay `index.html`:**

```
BRIDGE_KEY_DEFAULT → the same UUID as the extension
overlayId          → the same string as the extension's DEFAULTS.overlayId
--primary          → client brand color
--secondary        → client brand color
Logo               → client logo path
Title / ticker     → client defaults
Named spots        → client's spot labels, if the break uses them
```

**Not in the list, deliberately:** `SCORES_NAMESPACE` (removed in 2.4, see §11), the scores channel (always `"sports"`), `BRIDGE_BASE` (always the same host), and every line of SSE, sold-list, dedup and scores logic. Those are identical across all clients. Do not modify automation code during a clone build.

### The four things that must match, restated

Because it is the thing most often gotten wrong:

1. Extension `DEFAULTS.bridgeKey`
2. Overlay `BRIDGE_KEY_DEFAULT`
3. The `bridge_keys` row, with `active = true`
4. Extension `DEFAULTS.overlayId` equals the overlay's `overlayId`

**Any one of these wrong and the client silently breaks.**

---

## Appendix A: Salute Breaks, Where It Stands Versus the Standard

Salute is **Divisions/Board family**, cloned from `how-you-doin`. After the recent work it conforms on the core: `BREAK_TYPES`, `boardState`, `applySale`, `sseMarkSold` / `sseMarkUnsold` / `sseUpdateBuyer`, `breakIdMatches`, hardcoded `BRIDGE_BASE` and `BRIDGE_KEY_DEFAULT` (`f6a4de65...`), `salute.*` localStorage keys, and the name-first matcher fix from §9. In Supabase its bridge key is active with `automation`, `hosting` and `scores` all entitled.

**Salute-specific extensions.** These are non-standard but intentional. They are Salute's own, not candidates for the canonical:

- A second board mode (`premium`, `mode:'premium'`) with `PREMIUM_DIVISIONS`, ten named spots, rendered five per column by `renderPremiumBoard`, with a `body.premium-theme` skin, a `premiumSoldFlash` animation, and a traveling `wickRun` border flare.
- `SPECIAL_DIVISIONS`, meaning MISC, Downtowns and Main Chase, codes 9, 10 and 11, appended to the standard board.
- Background art through a JS-set `#bgArt` layer, because a CSS relative `url()` does not resolve in this context. **This one is the correct pattern and should be considered for promotion to the canonical reference.**

**Why Salute felt scattered.** It accumulated all of the above *before* this standard existed, so every small change meant re-deriving the structure from the file itself. With the baseline frozen, the remaining Salute work is cosmetic: spot sizing, casing, title text. Not structural. Going forward, Salute is defined as "`how-you-doin` plus the three documented extensions above", and nothing more.

---

*Maintenance: when a canonical reference changes, update this document and the `tsu-overlay-agent` skill references (`automation-standard.md`, `feature-registry.md`, `clone-protocol.md`, `heuristics.md`) in the same pass, so they can never contradict each other. When this document changes in a way that affects the operational runbook, check `card-break-overlay/docs/SOP-CLIENT-PROVISIONING.md` too. Those two are the only files allowed to describe the same procedure, and the SOP cites this one rather than restating it.*
