---
name: tsu-overlay-troubleshoot
description: Diagnose and fix issues with live TSU card-break overlays. Use when the user reports an overlay misbehaving in production — wrong team marked, sales not coming through, animations replaying, double-marking, chase numbers off, etc. Also triggers when the user pastes Supabase `bridge_events` data, Chrome console errors from the extension, or screenshots of the overlay/extension showing problems. NOT for new overlay builds (use tsu-overlay-agent for that).
---

# TSU Overlay Troubleshooting Playbook

You are diagnosing a live TSU card-break overlay issue. The system has known failure modes documented in `~/.claude/projects/C--Users-TSU-Documents-GitHub/memory/project_infrastructure.md`. Your job is to identify which one (or a new one) and fix it.

## Architecture refresher

```
Whatnot stream → content.js (Chrome extension, per host)
              → POST /events to bridge.tradesecretsunlocked.com
              → SSE stream to overlay (OBS browser source)
              → overlay renders team_sold / team_unsold / etc
              → Supabase logs every event in `bridge_events`
```

Three places things break: **extension** (detection), **bridge** (relay — rarely the cause), **overlay** (rendering).

## Step 1 — Identify the client and symptom

Ask which client if not stated. Get:
- Client name (e.g. `jp2-cards`, `jim-and-tabby`, `northland-breaks`)
- One-sentence symptom (e.g. "chasers marking OAK", "all teams replayed on refresh")
- Is the stream live right now? (affects whether to ship fixes immediately or stage)

## Step 2 — Pull Supabase evidence

Ask Mike to paste recent rows from `bridge_events` filtered by the client's `bridge_key`, OR query directly if MCP access is available. Look for the smoking guns:

- **Two distinct `overlay_id` values for the same `bridge_key`** → dual-extension overlap. One host is running an outdated extension. See Bug 4 below.
- **`code: "OAK"` paired with `title: "Chaser N"`** → OAK "as" alias bug. See Bug 1.
- **No `team_sold` events when chasers/packs sell** → Step 4 pass-through missing. See Bug 2.
- **`team_sold` for the same `saleId` repeating rapidly with empty/null `listingId`** → reassignment retry storm from sold-without-unsold. See Bug 3.
- **A burst of `team_sold` events all within ~1 second covering most of the break** → replay-on-reload. See Bug 5.
- **`code: ""` (empty) in events** → unresolved title; extension dropped it. Check what title triggered it.
- **`[TSU] poll error: Internal server error...` repeating every few seconds, and `team_sold` events stop partway through the day on a 24/7 seller** → Whatnot 500 on deep pagination of a marathon stream's sold-items list. See Bug 10.

## Step 3 — Match against the known-bug catalog

Read `project_infrastructure.md` for the full catalog. Quick reference:

| # | Symptom | Root cause | Fix location |
|---|---------|-----------|--------------|
| 1 | Chasers mark OAK | Bare `"as"` in OAK names array | Extension content.js team rules |
| 2 | Chaser/pack/prize-pack events dropped | No Step 4 pass-through | Extension `inferCodeFromTitle` |
| 3a | Old team unmarks but new team never marks | Unsold succeeds, sold fails | Extension main loop — capture unsold POST result, `continue` on failure |
| 3b | Spurious unsold events repeat in logs | `lastCodeByItem` not updated after sold failure | Already structured correctly; verify |
| 3c | Overlay's auto-reassignment fires spurious unsold | `team_unsold` payload missing `saleId` | Extension reassignment payload — add `saleId`+`id` |
| 4 | Team double-marked, ping-pongs between two teams | Two extensions on different hosts/machines | Operational — uninstall the old extension |
| 5 | Refresh → all sales replay with animations + buyer popups | Extension `seen` map lost on service-worker eviction | Extension — verify `loadPersistedMaps` exists. If missing, re-clone from template |
| 6 | "Chaser 10" marks as "Chaser 1" (or 2x→2, 3x→3) | `raw.includes(label)` substring match in overlay | Overlay `inferTeamCodeFromTitle` — use `labelMatches()` with digit-boundary check |
| 7 | localStorage shows old sold state on overlay reload | Intentional — overlay restores from localStorage | Use Reset button. Document only, not a bug. |
| 8 | Extension events 403 in Render logs | `bridge_keys.active` not `true` in Supabase | Set `active = true` in Supabase |
| 9 | OBS URL had stale Render bridge | `?bridge=` param overriding hardcoded constants | Use clean URL with no params |
| 10 | 24/7 stream: poll errors + automation goes dark mid-day | Whatnot 500s on deep pagination of a marathon stream's huge sold-list; one failed page killed the whole poll | Extension `fetchAllSoldEdges` — adaptive early-stop + per-page isolation (v2.2.1+) |
| 11 | OBS floods `Error decoding video` continuously (`repeated for N more lines`, ~30/sec) | Live iPhone `ios-camera-source` undecodable every frame — old obs-ios-camera plugin version/format mismatch, or Continuity Camera contending for the iPhone. NOT TSU | Client-side — hide source to confirm; disable Continuity Camera; match app/plugin versions; portrait shooters use Camo. SUPPORT-GUIDE §4 |
| 12 | Stream keeps disconnecting, `Reconnecting…`, WHIP `404` | Outbound OBS→Whatnot WebRTC/WHIP session ended/expired on Whatnot's side — NOT TSU | Client-side — restart the Whatnot stream (fresh WHIP session); check network. SUPPORT-GUIDE §11 |
| 14 | LIVE SCORES box never populates, no error anywhere | Overlay subscribes to channel `sports` on the **main bridge**. Scores come from a **different service** | Overlay — add `SCORES_BRIDGE_BASE` and connect `sports` against it. Bug 14 below |
| 15 | Board completely blank, no tiles, nothing marks sold | Syntax error anywhere in the single inline `<script>` kills the whole block | Overlay HTML — find the reported line, remove it, `node --check`. Bug 15 below |
| 16 | Fix verified locally but client sees no change (or vice versa) | Local working copy has drifted from what GitHub Pages actually serves | Rebase onto the deployed file. Bug 16 below |
| 13 | Team not marked sold after a purchase (intermittent; worse on See2Pick1 / Stash-or-Pass picks) | A sold item's title transiently **reverts to its slot number** (`CUSTOM_NNN` / `#NN`) after resolving to a real team. Overlay un-marked *any* previous code on a change → real team un-marked, slot marked instead. Extension also re-sent the real→slot downgrade. | Overlay `applyAssignmentPayload` **real→slot guard** (ignore the downgrade, keep the team marked) + extension `content.js` source-side downgrade guard (**v2.2.3+**). First rule out Bug 4 dual-instance: if every `(saleId,code)` fires **2×** in `bridge_events`, two extensions/tabs are running. |

## Step 4 — Verify the affected extension/overlay against the standards audit

Use the "Pre-deploy standard-compliance audit" section in `project_infrastructure.md`. Grep for the marker functions. If the client extension lacks any (e.g. no `loadPersistedMaps`), it's pre-patch and needs re-cloning.

Locations to check:
- Client extension: `C:\Users\TSU\OneDrive\cheech\Poke\TSU\Client files\<client>\extension-UPDATED-04-14-2026\content.js`
- Client overlay: `C:\Users\TSU\Documents\GitHub\card-break-overlay\overlays\<client>\index.html`
- Canonical templates: `card-break-overlay/extension-UPDATED-04-14-2026/`, `tsu-extension-v2.2/extension/`, `extension-template/`

## Step 5 — Apply the fix

Patch ALL affected copies:
1. The client's own extension/overlay files
2. The canonical template(s) — so future clients inherit it
3. Any drafts (`_drafts/<client>/`) that haven't shipped yet

If the bug is new (not in the catalog), add it to `project_infrastructure.md` under "Confirmed Working Standards" with the symptom → root cause → fix pattern.

Commit the repo changes with a descriptive message. Memory file lives outside the repo — edits there don't need committing.

## Step 6 — Verify and report

- Tell the user what was wrong, what was fixed, and what they need to do (refresh OBS, re-deploy extension, ask co-host to update, etc.)
- If the stream is live, distinguish "fix now" vs "fix after stream"
- If there are loose ends (e.g. another host still on old extension), name them explicitly

## Bug 10 (detail) — 24/7 marathon-stream deep-pagination 500

**Symptom.** A high-volume seller running one continuous stream all day (e.g. Northland, 8am–2am) sees the extension console fill with `[TSU] poll error: Internal server error has occured. (ID: …)` every few seconds, and `team_sold` events stop reaching the bridge partway through the day. Mornings are fine; it degrades as the list grows. Intermittent — some days run clean.

**Root cause.** The message + trace ID come from **Whatnot's** GraphQL API, relayed by `injected.js` (`payload.errors[0].message`) — not from TSU's bridge or overlay. The `soldItems` query uses `sort: null`, so the old `fetchAllSoldEdges` walked up to `MAX_PAGES` (12 × 24 = 288 items) every poll. On a never-ending stream the sold-items list grows into the thousands, and Whatnot 500s on deep cursor pagination of that list. Worse, one failed page threw away the **entire** poll, so a persistent 500 left the automation dark until the next morning's restart.

**Confirm via Supabase.** Bucket the client's `team_sold` events by hour in their timezone. Healthy day = sales every hour from stream start to ~2am. Failure day = a stall, often a catch-up spike when it briefly recovers, then a hard stop mid-day with no events until the next morning. The bridge cannot see the poll error itself — it only logs sales that got through.

**Fix (extension `fetchAllSoldEdges`, v2.2.1+).** Adaptive pagination:
- **Early-stop** — page from the newest items, stop after **2 consecutive fully-already-seen pages**. Steady state reads 1–2 pages instead of dragging the whole tail → no deep-cursor 500. Still pages as deep as *new* data requires (bursts/backlog), so accuracy is unchanged.
- **Per-page isolation** — a failed page keeps the edges already pulled and resumes next poll instead of discarding the whole poll → transient 500s self-heal instead of going dark.
- **Diagnostics** — each poll logs `[TSU] paged Np | N edges | totalCount~N`; poll errors append `totalCount`. Normal late-day polls should read `1p`/`2p` even with `totalCount` in the thousands.

Relies on Whatnot returning newest-first (the existing `.reverse()` already assumes this). If a future case shows new sales landing on deep pages, the fallback is an explicit newest-first `sort` (`ShopSortInput`) captured from a live Whatnot session.

**Operational stopgap** (no code): have the seller end + restart the Whatnot stream periodically → new `liveId` → small list → full pagination works.

## Bug 14 — LIVE SCORES never populates (right channel, wrong host)

**Symptom.** The LIVE SCORES panel or ticker sits on its placeholder ("No Games Found",
"Waiting for feed…") for the entire stream. No console error, no failed request, no 403.
Sales automation works perfectly, which makes it look like a scores-entitlement problem.

**Root cause.** Scores are **not** broadcast by the main bridge. They come from a separate
service:

```
sales   → https://bridge.tradesecretsunlocked.com   channel "main"
scores  → https://tsu-scores-bridge.onrender.com    channel "sports"   ← different HOST
```

An overlay that does `connectSSE(`${BRIDGE_URL}/stream?channel=sports&key=...`)` opens a
perfectly valid connection to a service that never publishes scores. It stays open, raises
no error, and delivers nothing forever. `bridge/server.js` carries a dated note saying so:
*"The main bridge does NOT broadcast ESPN scores to overlays today."*

**This is the trap.** Getting the channel right feels like the whole job. Blue Light Rips was
"fixed" on 2026-08-15 by adding the `sports` subscription — on the wrong host — and the
`known_issues` row was marked resolved. It was still broken on 2026-08-18.

**Confirm.** You cannot see this in `bridge_events`; the bridge deliberately never logs
`scores`. Two ways:

```bash
grep -c 'tsu-scores-bridge' overlays/<client>/index.html   # must be 1
grep -c 'onrender.com'      overlays/<client>/index.html   # must be 1, the line above
```

or in OBS → DevTools → Network → filter `stream`: there must be an **open** connection to
`tsu-scores-bridge.onrender.com`.

**Fix.**

```js
const SCORES_BRIDGE_BASE = "https://tsu-scores-bridge.onrender.com";
function getScoresChannel(){ return "sports"; }   // bare string, never templated

connectSSE(`${SCORES_BRIDGE_BASE}/stream?channel=${encodeURIComponent(getScoresChannel())}`
         + `&key=${encodeURIComponent(BRIDGE_KEY)}`);
```

Also accept **both** event names — the deployed producer emits `scores`, the stale in-repo
producer emits `scores_update`, and the two docs disagree about which is current:

```js
if (type === "scores" || type === "scores_update") { ... }
```

and register `scores_update` in the named-listener array, because named SSE events bypass
`onmessage` entirely.

**Blast radius.** `docs/SCORES-CONFIG-AUDIT.md` (2026-08-12) found **31 of 34** scores-wired
overlays on the wrong host, including `legends-hobby`, the Row-grid canonical reference.
Working references to copy from: `doghouse-breaks`, `jp2-cards`, `quantum-breaks`.

**Entitlement is a red herring.** `client_services.scores` gates nothing today — the score
service's `/stream` performs no key check and no entitlement lookup. Confirm entitlement so
billing is right, but it will never be the cause.

---

## Bug 15 — Board completely blank (dead inline script)

**Symptom.** Frame, header, control bar and panels all render, but there are **no team
tiles**, nothing marks sold, and the scores box never leaves its placeholder.

**Root cause.** A TSU overlay is one self-contained file with **one** inline `<script>`. A
syntax error anywhere in that block means the browser parses **none** of it. No tiles, no
SSE, no handlers. The static HTML shell still paints, so it reads as a data problem instead
of a dead script.

Seen 2026-08-18: a stray keystroke saved into a local copy of `blue-light-rips`:

```
-*rw2 e jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj
```

**Confirm.** Load the file in a browser and look at the console — a single
`Uncaught SyntaxError` and a missing `[TSU]` build stamp is conclusive. Locally:

```bash
python3 - <<'EOF'
import re; s=open('index.html',encoding='utf-8').read()
open('/tmp/x.js','w',encoding='utf-8').write('\n'.join(re.findall(r'<script>(.*?)</script>', s, re.S)))
EOF
node --check /tmp/x.js
```

**Fix.** Remove the stray text and re-run `node --check`. **Then check Bug 16** before
telling anyone the client is affected.

**Prevention.** `node --check` on the extracted script is now a required gate before any
overlay ships. It is the same gate the extension has had since 2026-08-11.

---

## Bug 16 — Local copy has drifted from what the client runs

**Symptom.** A fix is verified locally but the client reports no change, or a bug reproduces
locally that the client has never seen.

**Root cause.** The mounted GitHub folder has **no network egress**, so nothing pushes from a
Cowork session. Local edits accumulate against a file that GitHub Pages is not serving.

**Confirm.** Ask Mike to pull the deployed file from GitHub — he saves it as
`git-index.html` in the client folder — then:

```bash
diff -u overlays/<client>/git-index.html overlays/<client>/index.html
```

**Fix.** Rebase onto the **deployed** file. If the local copy has no changes worth keeping,
`git checkout` it. On 2026-08-18 the local blue-light-rips file differed from GitHub by
exactly one line — the Bug 15 corruption — so the client was never affected and the local
file had nothing to preserve.

**Do this FIRST** on any "why is this broken for the client" question. Diagnosing the wrong
file wastes the whole investigation and can raise a false alarm.

---

## Extension version log

| Version | Date | Change |
|---|---|---|
| v2.2 (`extension-UPDATED-04-14-2026`) | 2026-04-14 | Canonical baseline — multi-tenant bridge, full pagination, retry, stable IDs, `loadPersistedMaps`. |
| **v2.2.1** | 2026-06-15 | **Adaptive pagination** (early-stop + per-page isolation + diagnostics) — fixes Bug 10. Deployed to **Northland** for live test; **propagate to canonical templates after confirmation.** |

## When NOT to use this skill

- Building a new overlay from scratch → use `tsu-overlay-agent`
- Designing visual changes (colors, layout) → just edit the overlay HTML directly
- Bridge server changes → those are rare; check `bridge/server.js` only if events aren't reaching Supabase at all

## Communication style

Mike runs this business solo. Lead with the diagnosis, not the investigation. Show evidence (Supabase rows, line numbers) so he can verify your reasoning. Be specific about what file:line was changed and why. When you're guessing, say so.

---

## Companion: front-line support guide

For a broader, support-oriented troubleshooting reference — covering machine/OBS
resource issues (board-freeze, packet drops / "decoding queue overloaded"), key/403
problems, connection vs. data isolation, deduped revenue, and a copy-paste Supabase
query reference — see `SUPPORT-GUIDE.md` in this folder. That guide is written for
front-line TSU support (layer-isolation first); this SKILL.md remains the engineering
deep-dive for overlay/extension bug fixes.
