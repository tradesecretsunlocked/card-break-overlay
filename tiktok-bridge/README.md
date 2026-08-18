# tsu-tiktok-bridge v2

TSU's TikTok Shop bridge. **Official Open API only.** No browser extension, no unofficial
connector. Webhooks and polling in, SSE out to the same OBS overlays TSU already ships.

Canon for the integration is `TSU-TIKTOK-INTEGRATION.md` at the GitHub root.
**`GO-LIVE.md` in this folder is the step-by-step deployment runbook.** This README is the
reference.

This service lives at `card-break-overlay/tiktok-bridge/` and deploys from the
`card-break-overlay` repo with Render **Root Directory** set to `tiktok-bridge`, mirroring
how `card-break-overlay/bridge/` already deploys as the main bridge.

> **v1 is dead.** The old `tsu-tiktok-bridge` was built on `tiktok-live-connector` and is
> archived at `archived/2026-08-15-tiktok-reset/`. This service shares no code with it.

---

## The one thing that makes this work

**An existing overlay renders a TikTok sale without being modified.**

The bridge normalizes every TikTok order into the exact `team_sold` payload the Whatnot
extension already emits, verified field for field against a live production row:

```json
{ "id": "...", "ts": 0, "code": "MIN", "type": "team_sold", "buyer": "...", "sport": "nfl",
  "title": "Minnesota Vikings", "amount": 4, "liveId": "...", "saleId": "tt:...",
  "channel": "main", "currency": "USD", "teamCode": "MIN", "buyerName": "...",
  "listingId": "...", "productId": "...", "overlay_id": "...", "amountCents": 400 }
```

Three rules hold that together:

1. `src/teamCodes.js` is **lifted verbatim** from the extension's resolver. Copied, not
   rewritten, so the same break cannot light up different tiles on different platforms.
   Re-copy it when the extension changes; never hand-patch it.
2. `saleId` is namespaced `tt:`, so a TikTok id can never collide with a Whatnot id in
   the overlay's dedupe set. That matters for dual-provisioned clients.
3. Overlay context (overlay id, sport, break) is read from the overlay's own
   `overlay_warmup` event, so it cannot drift from what the board is showing.

---

## Setup

### 1. Database

**Already applied to production on 2026-08-17.** `supabase/migration.sql` is kept as the
record and for rebuilding a fresh environment. Additive only. One nullable column with a default on `bridge_events` and
`bridge_events_archive`, six new tables, and a backfill that marks every existing active
client as `whatnot / entitled / enabled`. **No view is touched**, so `v_sales`,
`v_sales_daily` and `v_break_pnl` pick up TikTok for free. Rollback block is at the
bottom of the file.

**Nobody is granted TikTok by the migration.** That is a deliberate per client action.

### 2. Environment

In production these are **Render environment variables**, not a file. `.env` is for
running locally only, and `.gitignore` blocks it from ever being committed.

```bash
cp .env.example .env   # local development only
```

`TIKTOK_APP_SECRET` comes from Partner Center, Manage app secret.
`SUPABASE_SERVICE_ROLE_KEY` is the same one the main bridge already uses.

### 3. Partner Center

**Both done as of 2026-08-17.**

Redirect URL is set to `https://tiktok-bridge.tradesecretsunlocked.com/tiktok/callback`.

Four scopes are active: `seller.shop.info`, `seller.authorization.info`,
`seller.order.info`, `seller.product.basic`. A fifth,
`seller.order.ext_ref.read`, is a custom scope needing a written application plus
screenshots; it is not required for the sold path. See `GO-LIVE.md` step 9.

Adding a scope later **forces every existing client to re-authorize**, so decide the full
set before onboarding real clients.

### 4. Run

```bash
npm install
npm test        # 22 tests, no network needed
npm start
```

---

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | status, SSE client count, resolved API versions |
| `GET /tiktok/authorize?bridge_key=...` | starts the seller handshake, redirects to TikTok |
| `GET /tiktok/callback` | exchanges `auth_code`, stores tokens and `shop_cipher` |
| `POST /tiktok/webhook` | signature verify, dedupe, enqueue, 200 in under 3 seconds |
| `GET /stream?key=<bridge_key>&channel=main` | SSE to the overlay |
| `GET /admin/status/:bridgeKey` | auth state, granted scopes, expiry |
| `POST /admin/webhooks/:bridgeKey` | registers topics 1, 6, 7 for that shop |
| `POST /admin/reconcile` | forces a reconciliation sweep |

Admin routes need `x-admin-token`. Overlays authenticate with their bridge key.

---

## Test run, end to end

1. Create a **Development Shop** in Partner Center. *Max 10 test accounts ever, they
   expire after 180 days, and linking a TikTok account is irreversible.*
2. Provision the test client:
   ```sql
   insert into client_platforms (bridge_key, platform, entitled, enabled)
   values ('<bridge_key>', 'tiktok', true, true);
   ```
   Both booleans must be true. `enabled` true with `entitled` false gives a client whose
   every feature 403s with no other symptom.
3. Authorize: open `/tiktok/authorize?bridge_key=<key>` and approve.
4. Register webhooks: `POST /admin/webhooks/<key>` with the admin token.
5. Connect the overlay to `/stream?key=<key>`, or just `curl -N`.
6. Place an order in the Development Shop with a SKU named after a real team, for example
   `Minnesota Vikings`, or a slot number like `#22`.
7. Expect within seconds: a `team_sold` on the SSE stream, a matching row in
   `bridge_events` with `platform='tiktok'`, and the tile lighting on the board.

**Done means:** an unmodified existing overlay renders it.

---

## Things that will bite, and why they are handled

| Trap | Handling |
|---|---|
| Signature must cover the exact transmitted bytes | Body stringified once, signed and sent as the same string. Test 18 proves whitespace breaks it. |
| `grant_type` is the literal `authorized_code` | Not the standard OAuth spelling. Wrong value returns `36004004`, which reads like an expired code. |
| Webhook signature is over the **raw body** | `express.raw()` is mounted before `express.json()`. Order matters. |
| Webhooks must answer in **3 seconds** | Handler does verify, dedupe, `res.end()`, then `setImmediate`. Never await work inline. |
| Delivery is at least once, unordered | `tiktok_webhook_log` primary key dedupes; `alreadyEmitted()` guards replays across restarts. |
| Webhook says `CANCEL`, API says `CANCELLED` | Both mapped in `normalizeStatus`. |
| `UNPAID` fires **before** payment | Treated as sold. TikTok's own guidance is to hold inventory there, and for a break that is when the slot is gone. |
| **No `quantity` on a line item** | Two of a SKU means two line items. One event each, never multiplied. Test 7. |
| `room_id` is read only and not filterable | Reconciliation pulls by `update_time` and groups on `room_id` afterwards. |
| Webhooks are not a source of truth | Reconciliation poller rewinds **16 hours**, longer than the 15.5 hour retry ladder. |
| Access token lives 7 days | Refresh worker runs on a 48 hour margin. Refresh expiry is an absolute timestamp and is never derived. |
| Analytics sits in the 0.2 to 1 req/sec bucket | Exponential backoff on `36009002` and HTTP 429. |
| Missing `shop_cipher` returns `106013` | Fetched at callback time and stored, so no call site has to think about it. |

---

## Known open items

| # | Item |
|---|---|
| 1 | **API version drift.** The docs pages and the bundled OpenAPI spec disagree: `live_rooms/*` is 202502 vs 202309, blind box is 202605 vs 202511. Every version lives in `src/config.js` and nowhere else, with candidates listed. Resolve against the Development Shop before Phase 2. |
| 2 | **Live analytics is not wired yet.** `creator.data.live.read.public` looks like a creator grant separate from the seller grant, and `live_room_id` has no known source at stream start. Client methods exist and are unused. |
| 3 | Topics 17 and 27 are received and logged; 27 has a handler, 17 does not yet. |
| 4 | Roughly ten webhook topics have no published numeric id. They are logged raw so the Development Shop reveals them. |

---

## What this service deliberately does not do

- No browser extension. Whatnot and Loupe keep extensions; TikTok never gets one.
- No unofficial LIVE chat or gift feed. `tiktok-live-connector` breaches Developer ToS
  3.5(a)(e)(j)(m)(o) and falls under a 120 point violation category, which is permanent
  removal from the Service Market across every account of the same entity.
- No cross-seller aggregation. Developer ToS 2.7(g) forbids it. Every metric stays inside
  one seller's own view.
- No per client Render service. One bridge per platform, never one per client.
