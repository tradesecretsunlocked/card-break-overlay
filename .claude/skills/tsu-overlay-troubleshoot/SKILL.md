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
