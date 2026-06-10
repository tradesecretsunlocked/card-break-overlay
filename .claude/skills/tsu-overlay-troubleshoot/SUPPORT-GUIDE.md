# TSU Overlay — Support Troubleshooting Guide

Reusable playbook for TSU support. Use it when a client reports an overlay/stream issue.
Work top-down: **isolate the layer first** (machine → OBS → overlay → bridge → data), then
apply the fix. Most "overlay is broken" tickets are actually OBS or machine issues.

---

## 0. The 30-second triage

Ask / check these before anything else — they route you to the right section fast:

1. **Is the board missing entirely, or showing but not updating?**
   - Missing/blank → §2 (connection/key) or §3 (wrong URL)
   - Shows but frozen / won't update → §1 (resource exhaustion) or §4 (stream silent)
2. **Does a full computer reboot fix it temporarily?** → §1 (resource exhaustion). Reboot
   "fixing" it = the problem is below the overlay (OBS/machine), not the HTML.
3. **Does the overlay's Reset button fix it?** → if yes, it's overlay state, not infra.
4. **Recently migrated / new key / new install?** → §9.

### The architecture (so you know which layer to suspect)
```
Whatnot stream → Chrome extension (content.js) → POST /events
   → bridge.tradesecretsunlocked.com (Render, shared) → Supabase logs + SSE broadcast
   → overlay index.html (OBS browser source)
```
Isolated per client by **bridge_key** (UUID) + **channel** ("main"). One bridge serves everyone.

### The 3 things that differ per client (90% of "it broke" causes)
1. Extension `content.js` DEFAULTS — `bridgeKey`, `sport`, `overlayId`, `channel`
2. Overlay `index.html` constants — `BRIDGE_BASE`, `BRIDGE_KEY`, default `overlayId`
3. Supabase `bridge_keys` row — `active = true`

If any one of those three disagrees, the client breaks. Always verify all three match.

---

## 1. Team board freezes / won't update after a while (only reboot fixes it)
*(The Northland / Ty Styx pattern: "works ~5 breaks after a full computer reset, then
won't update even after Reset.")*

**Most likely cause:** OBS browser-source / machine resource exhaustion. The JS keeps
running but the render thread starves, so paints stop → looks frozen. Reset only clears
JS state, so it doesn't help; only restarting OBS or rebooting frees the resources.
Usually paired with OBS log lines: `Decoding queue overloaded… frames behind` / `Error
decoding video` (see §4).

**Diagnose (catch it broken — don't reboot first):**
- Right-click overlay source → **Interact** (or open the overlay URL in Chrome on that PC) → console.
  - Errors? Status pill stuck on `reconnecting`?
  - Network tab: is the `/events` SSE stream still receiving, or dead?
  - **Data arriving but board not painting = resource starvation. Stream dead = §2/§4.**
- Task Manager → Performance + Details: total RAM, GPU %, and OBS / CEF helper memory.
  Climbing into multiple GB or pegged GPU = confirmed.

**Fix (in order):**
1. OBS → right-click overlay → Properties → enable **"Refresh browser when scene becomes
   active"** and **"Shutdown source when not visible."** Gives a clean overlay per scene.
2. Lower the *other* heavy source (capture card / media): drop 1080p60 → 1080p30, lower bitrate.
3. Move OBS encoder to hardware (NVENC / QuickSync) so the CPU isn't fighting the browser source.
4. Confirm browser-source resolution matches the canvas (not 4K).

**Stopgap for the client:** toggle the scene (or restart *just OBS*, not the whole PC) when
it stalls — faster than a reboot.

**Escalate to engineering if:** data is confirmed still arriving over SSE but the board won't
paint even on a fresh, lightly-loaded OBS. Capture: OBS log (Help → Log Files → Upload
Current), Task Manager memory screenshot at freeze, and # of breaks before failure.

---

## 2. Overlay blank / "OFF" / never connects (403 / key issues)

**Symptom:** overlay loads but status pill never goes `live`; no events ever arrive.

**Likely cause:** bridge key missing, wrong, or `active = false`; or the three-way
key mismatch (§0).

**Diagnose:**
- Open the overlay URL in Chrome → Network tab → look at the `/events` (or `/stream`) request.
  - **403** = key rejected (inactive or not found). → check Supabase below.
  - **401** = no key in the URL/extension at all.
  - **200 + open** = connected; problem is elsewhere (§3).
- In Render logs, find the client's reject line. (After the logging patch ships, it reads
  `[403] reject client="…" reason=inactive|not_found …`.)
- Supabase check:
  ```sql
  select key, client_name, active, notes, updated_at
  from bridge_keys where client_name ilike '%CLIENT%';
  ```

**Fix:**
- `active = false` but should be live → set `active = true`. Takes effect within ~5 min
  (KEY_CACHE_TTL). For instant effect, the bridge cache must expire.
- Key mismatch → make extension DEFAULTS, overlay constants, and the Supabase row all use
  the same key.

---

## 3. Connected, but sales don't appear on the board

**Symptom:** status `live`, but selling teams on Whatnot doesn't update the overlay.

**Likely causes & checks:**
- **`overlayId` mismatch** — extension DEFAULTS `overlayId` must equal the overlay's default
  `overlayId`. Mismatch = events broadcast but ignored. Most common cause.
- **Channel mismatch** — both must be `main`.
- **Extension not running / not on the Whatnot tab** — check `chrome://extensions`, confirm
  it's enabled and the content script is active on the live stream tab.
- **Confirm events are actually flowing:**
  ```sql
  select event_type, count(*), max(occurred_at)
  from bridge_events
  where bridge_key = 'CLIENT_KEY' and occurred_at > now() - interval '1 hour'
  group by 1 order by 3 desc;
  ```
  - Rows present → bridge is receiving; problem is overlay-side (overlayId/channel).
  - No rows → extension isn't posting (key/permission/selector issue).
- **Team code not inferred** — if titles don't map to a team code, the tile won't mark.
  Check the console for the parsed payload.

---

## 4. "Decoding queue overloaded / frames behind / Error decoding video"
*(OBS log spam, dropped FFMpeg packets.)*

**This is NOT a TSU overlay bug.** It's OBS's video input/encode pipeline overwhelmed —
the machine can't decode/encode the incoming feed fast enough.

**Fix:**
- Lower the source's resolution/FPS/bitrate (capture card or media source).
- Switch to a hardware encoder (NVENC/QuickSync); check CPU/GPU headroom in Task Manager.
- Update GPU drivers and OBS.
- Reduce total scene load (fewer high-res sources, fewer always-animating elements).

It can *coincide* with §1 because a starved machine hurts both the video pipeline and the
browser source — but fix it as an OBS/machine problem.

---

## 5. Sales numbers look wrong / double-counted

**Symptom:** revenue or sold counts look inflated.

**Cause:** raw `bridge_events` overcounts (~60%) — multiple events per sale. **Never sum
raw events for revenue.**

**Fix:** always use the deduped views — `v_sales`, `v_sales_daily`, `v_break_pnl`.
sale = latest event per `saleId`; break = `productId`; `liveId` = stream.

---

## 6. SOLD effects / shatter / audio not playing

**Cause:** missing/blocked asset (gif, audio) or autoplay restrictions.

**Checks:**
- Console for `shatter gif missing` / `shatter audio missing` warnings or 404s on assets.
- OBS browser source: a one-time user gesture may be needed for audio; confirm "Control
  audio via OBS" is set as desired.
- Verify asset paths resolve from the hosted overlay (no local file paths).

---

## 7. Scores ticker not updating

**Cause:** scores is a gated feature; the scores SSE channel is separate.

**Checks:**
- Is the client entitled? `client_services` row `service='scores', enabled=true`.
- Overlay built with scores enabled (`ENABLE_SCORES`)?
- Scores events flowing? `select count(*) from bridge_events where event_type in
  ('scores','scores_update') …` — note these are intentionally **not** persisted long-term,
  so check live, not history.

---

## 8. Wrong teams / wrong sport showing

**Checks:**
- Extension DEFAULTS `sport` matches the break.
- Overlay `currentBreakType` / break config matches what they're running.
- A `set_sport` event auto-switches; confirm it's not flipping unexpectedly mid-break.

---

## 9. Just migrated / new key / leftover old overlay (the "phantom 403" case)
*(The Jim & Tabby pattern: a deactivated key hammering the bridge with 403s.)*

**Symptom:** Render shows a steady stream of 403s from one key/IP; that client may also
appear `revoked`/`stale` in the health view.

**Cause:** an old OBS browser source (old scene, or a reinstalled old overlay file) still
points at the **deactivated** key and auto-reconnects forever.

**Fix:**
- Confirm the client is on the NEW overlay URL + key (verify all three of §0's items).
- Delete the stale browser source / old scene still using the old key.
- Confirm the live key is `active = true` and the old one is `active = false`.

**Find the culprit key:**
```sql
select key, client_name, active, notes from bridge_keys where active = false;
-- match the 403 key prefix in Render logs to a client_name
```

---

## Quick reference — Supabase queries support uses most

```sql
-- Who's a given key?
select key, client_name, active, notes from bridge_keys where key = 'KEY';

-- Is a client sending events right now?
select event_type, count(*), max(occurred_at) from bridge_events
where bridge_key = 'KEY' and occurred_at > now() - interval '1 hour' group by 1;

-- Overlay health snapshot
select client_name, health_status, seconds_since_last_event
from v_overlay_health where client_name ilike '%CLIENT%';

-- Open tickets
select id, client_name, priority, status, subject, created_at
from support_tickets where status not in ('resolved','closed') order by created_at;

-- Deduped revenue (NEVER sum raw bridge_events)
select day, sales, gross from v_sales_daily order by day desc limit 7;
```

## Escalation checklist (attach to any engineering hand-off)
- Client name + bridge key (prefix is fine)
- Symptom + exactly when it started / how often
- Which layer you isolated it to (machine / OBS / overlay / bridge / data)
- Console errors + Network SSE status (open & receiving? 401/403/200?)
- OBS log file (Help → Log Files → Upload Current) if video/freeze related
- Task Manager memory screenshot if resource-related
- # of breaks/sales before failure (for intermittent issues)

---

## Future hardening ideas (not yet built — engineering)
- **Stale-stream watchdog in the overlay:** if no SSE message received in N seconds while
  the connection is "open," force a reconnect. Catches half-dead connections that don't
  fire `onerror`.
- **breakId guard end-to-end:** have the extension stamp a breakId and the overlay filter
  on it (`breakIdMatches`) — prevents cross-break event bleed. Requires coordinated
  extension + overlay change; do NOT add the guard to the overlay alone (it will reject all
  events).
- **Bridge reject logging + `/admin/rejects`** (drafted separately) — surfaces phantom-403
  stale overlays automatically.
```
