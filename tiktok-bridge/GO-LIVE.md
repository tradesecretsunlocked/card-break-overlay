# TikTok bridge: go live

Written 2026-08-17. Follow top to bottom. Anything marked **DONE** needs nothing from you.

---

## Where things stand

| Step | Status |
|---|---|
| Supabase migration | **DONE, applied to production** |
| App redirect URL | **DONE** (you had already set it) |
| Phase 1 API scopes | **DONE, 4 of 4 active** |
| Code written and tested | **DONE**, 22/22 tests pass |
| Code location | **DONE**, `card-break-overlay/tiktok-bridge/` |
| Development Shop | **DONE** (you said it is ready) |
| Push to GitHub | you, step 1 |
| Create the Render service | you, step 2 |
| Environment variables | you, step 3 |
| Register webhooks | you, step 4 |
| Provision your test client | you, step 5 |
| Authorize and test | you, steps 6 to 8 |
| Custom scope application | you, step 9, optional for now |

---

## What I already changed, so nothing surprises you

**Supabase, project `tsu-bridge` (znyryhgjghjsobkzyfbx).** Five migrations applied, all additive:

- `platform` column added to `bridge_events` and `bridge_events_archive`, defaulting to `whatnot`. All 364,033 existing rows are tagged `whatnot`.
- Six new tables: `client_platforms`, `tiktok_shop_auth`, `tiktok_oauth_state`, `tiktok_webhook_log`, `tiktok_live_sessions`, `tiktok_sync_cursor`.
- All 76 active clients backfilled as `whatnot / entitled / enabled`. **Nobody was given TikTok.**

Verified after: `v_sales` 134,305 rows, `v_sales_daily` 591, `v_break_pnl` 5,340. No view was touched and none broke.

**Partner Center.** Four scopes switched on: Global Shop Information, Shop Authorized Information, Order Information, Product Basic. Active count went 0 to 4.

**Files.** The bridge moved from `GitHub\tsu-tiktok-bridge\` into `card-break-overlay\tiktok-bridge\`, because your main bridge already deploys from `card-break-overlay\bridge\` and this way you do not need a new GitHub repo. The old copy is in `_to_delete\2026-08-17-tiktok-bridge-moved-into-card-break-overlay\`.

---

## Step 1. Push the code

`card-break-overlay` has a lot of unrelated uncommitted changes, so commit only the new folder:

```bash
cd C:\Users\TSU\Documents\GitHub\card-break-overlay
git add tiktok-bridge
git commit -m "Add TikTok Shop bridge v2 (official Open API only)"
git push origin main
```

---

## Step 2. Create the Render service

Render dashboard, **New**, **Web Service**, connect `tradesecretsunlocked/card-break-overlay`.

| Field | Value |
|---|---|
| Name | `tsu-tiktok-bridge` |
| Region | same as your existing bridge |
| Branch | `main` |
| **Root Directory** | `tiktok-bridge` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Starter or higher |

**Root Directory is the field people miss.** Without it Render builds the whole repo and finds no `package.json`.

**Do not use the free tier.** Free instances sleep after 15 minutes idle. A sleeping bridge misses webhooks during a break, and TikTok will not retry for 2 minutes.

Then **Settings, Custom Domain**, add `tiktok-bridge.tradesecretsunlocked.com` and create the CNAME Render gives you at your DNS provider. The redirect URL in Partner Center already points there, so this has to match.

---

## Step 3. Environment variables

**Put these in Render, not in a `.env` file.** Render dashboard, your service, **Environment**, **Add Environment Variable**. The `.env` file is for running on your own machine only, and `.gitignore` blocks it from ever being committed.

Copy each value yourself. I have deliberately never read either secret.

| Key | Value | Where to get it |
|---|---|---|
| `TIKTOK_APP_KEY` | `6k99cjquf3k04` | already known, paste as is |
| `TIKTOK_APP_SECRET` | secret | Partner Center, App & Service, TSU Team Break Overlay, **Manage app secret**, reveal and copy |
| `TIKTOK_SERVICE_ID` | `7649022192786409230` | paste as is |
| `PUBLIC_BASE_URL` | `https://tiktok-bridge.tradesecretsunlocked.com` | paste as is, no trailing slash |
| `SUPABASE_URL` | `https://znyryhgjghjsobkzyfbx.supabase.co` | paste as is |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | Supabase dashboard, Project Settings, API keys, **service_role**. Same value your main bridge already uses. |
| `PORT` | `10000` | Render's default port |
| `LOG_LEVEL` | `info` | |
| `ADMIN_TOKENS` | make one up | any long random string. You send it as the `x-admin-token` header on admin calls. Treat it like a password. |

Deploy. Then check:

```
https://tiktok-bridge.tradesecretsunlocked.com/health
```

You want `"ok": true` and **`"db": true`**. If `db` is false the service role key is wrong.

---

## Step 4. Register the webhooks

> **ORDERING: do steps 5 and 6 FIRST, then come back here.** This step needs an
> authorized client to register against. Skipping it is the single most common failure:
> everything looks correct, the overlay connects, and no sale ever arrives, because
> TikTok was never told to send anything.

```bash
curl -X POST https://tiktok-bridge.tradesecretsunlocked.com/admin/webhooks/<BRIDGE_KEY> \
  -H "x-admin-token: <YOUR_ADMIN_TOKENS_VALUE>"
```

Registers topics 1 (order status change), 6 (deauthorization) and 7 (authorization expiring). The response lists what TikTok now has on file.

---

## Step 5. Provision your test client

Pick the bridge key you want to test with. In Supabase SQL editor:

```sql
insert into client_platforms (bridge_key, platform, entitled, enabled)
values ('<YOUR_TEST_BRIDGE_KEY>', 'tiktok', true, true)
on conflict (bridge_key, platform) do update
  set entitled = true, enabled = true;
```

**Both booleans must be true.** `enabled` true with `entitled` false is the failure mode where every feature returns 403 with no other symptom, exactly like `client_services`.

To find your test key:

```sql
select key, client_name from bridge_keys
where active = true and archived_at is null
order by client_name;
```

---

## Step 6. Authorize the Development Shop

Open in a browser:

```
https://tiktok-bridge.tradesecretsunlocked.com/tiktok/authorize?bridge_key=<YOUR_TEST_BRIDGE_KEY>
```

You get redirected to TikTok, you approve, and you land back on a TSU-branded "Connected" page. That page appearing means the token exchange and the shop cipher fetch both worked.

Confirm:

```bash
curl https://tiktok-bridge.tradesecretsunlocked.com/admin/status/<BRIDGE_KEY> \
  -H "x-admin-token: <YOUR_TOKEN>"
```

Look at `granted_scopes`. You should see the four scopes. Now go back and do step 4.

---

## Step 7. Watch the stream

```bash
curl -N "https://tiktok-bridge.tradesecretsunlocked.com/stream?key=<BRIDGE_KEY>&channel=main"
```

You should immediately get a `bridge_hello`. Leave it running.

**To point a real overlay at the TikTok bridge, no rebuild is needed.** Every TSU overlay
already accepts two URL overrides (`getBridgeBase()` returns `getParam('bridge')` and
`getBridgeKey()` returns `getParam('key')`). Append them to the normal overlay address:

```
?bridge=https://tiktok-bridge.tradesecretsunlocked.com&key=<BRIDGE_KEY>
```

Paste that full address into OBS as the Browser Source. Drop the two values off the end
and the same file goes back to working normally on Whatnot.

---

## Step 8. Place a test order

In the Development Shop, create a product whose **SKU name is a real team name**, for example `Minnesota Vikings`, or a slot number like `#22`. Buy it.

Within a few seconds you should see:

1. A `team_sold` frame on the curl stream, with `"code":"MIN"` and `"platform"` handling intact.
2. A row in Supabase:
   ```sql
   select event_type, payload->>'code' as code, payload->>'buyer' as buyer, occurred_at
   from bridge_events
   where platform = 'tiktok'
   order by occurred_at desc limit 10;
   ```
3. The tile lighting on the board, if you pointed a real overlay at it.

**That third one is the whole point: an unmodified overlay rendering a TikTok sale.**

---

## Step 8b. Placing a test order

Authorising lets TSU ask TikTok questions. Webhooks make TikTok talk to us. This is how
you make something actually happen.

### One time, on your machine

```bash
npm install -g @tts-open-toolkit/cli
tts_open_toolkit doctor
tts_open_toolkit auth login          # opens a browser, approve with Partner Center
tts_open_toolkit auth status --json
```

### Create the product by hand, once

The CLI can create orders but **not products**. Make the product in Partner Center under
Development Kits, Development Shops, and **name the SKU exactly like a board tile**:
`Minnesota Vikings` for a team test, `#22` for a slot test. Give it stock of 5 or more.

### Then create orders from the terminal

```bash
tts_open_toolkit sandbox shop list --region-code 840 --json
tts_open_toolkit sandbox product list --shop-id YOUR_SHOP_ID --json

tts_open_toolkit sandbox order create \
  --shop-id YOUR_SHOP_ID \
  --item PRODUCT_ID:SKU_ID:1 \
  --order-count 1 \
  --logistics-service-id YOUR_SANDBOX_LOGISTICS_ID \
  --payment-method YOUR_SANDBOX_PAYMENT_METHOD \
  --json

tts_open_toolkit sandbox order list --shop-id YOUR_SHOP_ID --page-size 10 --json
```

**Never invent `logistics-service-id` or `payment-method`.** They are sandbox fixtures
listed in your Development Shop settings.

**If the create errors, read before retrying.** It can exit nonzero and still have
created the order. If an `order_id` came back, do not create a second one. A new order
can take up to 30 seconds to become visible, which is not a failure.

To advance an order one state at a time (`UNPAID` to `ON_HOLD` to `AWAITING_SHIPMENT`
and so on):

```bash
tts_open_toolkit sandbox order transition ORDER_ID --shop-id YOUR_SHOP_ID --json
```

For a basic board test you do not need this: TSU treats `UNPAID` as sold, because that
is the moment the slot is gone.

### Watch it land

Leave this running before you create the order:

```bash
curl -N "https://tiktok-bridge.tradesecretsunlocked.com/stream?key=BRIDGE_KEY&channel=main"
```

`bridge_hello` immediately, then `team_sold` a few seconds after the order is created.

---

## Step 9. Optional, the custom scope application

`Read External Order References` is not a toggle, it needs a written application with 3 to 10 screenshots. It is not required for anything above. It is what later lets you stamp TSU break and slot IDs onto TikTok orders.

Partner Center, Manage API, search `Read External`, **Apply**. Paste this into "Reasons for application":

> Trade Secrets Unlocked provides live-selling overlay and sales-automation software for TikTok Shop sellers who run live break sales. Our application assigns an internal break identifier and slot identifier to each item a seller offers during a LIVE session. We need to read external order references so that we can reconcile a TikTok Shop order back to the specific break and slot in our own system, which is how the seller's on-screen board, their post-break reporting, and their profit and loss calculation stay accurate. We only read references our own application previously wrote for that seller. We do not read, aggregate, or share data across sellers.

For screenshots, use overlay screenshots showing the sold board and the seller's reporting view.

---

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| `/health` shows `"db": false` | wrong `SUPABASE_SERVICE_ROLE_KEY` | re-copy the service_role key, not the anon key |
| Authorize page errors immediately | `TIKTOK_SERVICE_ID` wrong or redirect URL mismatch | both must match Partner Center exactly, no trailing slash |
| "This link has already been used or has expired" | the auth code is single use and lasts 30 minutes | start again at step 6 |
| Stream returns 403 "not provisioned for tiktok" | step 5 not done, or one boolean false | both `entitled` and `enabled` must be true |
| Webhooks never arrive | not registered, or the domain is not live | re-run step 4, confirm the custom domain resolves over HTTPS |
| Order arrives but no tile lights | the SKU name does not resolve to a team code | name the SKU exactly like a team, or `#22`. Check the logs for a dropped line item. |
| Error `106001` in logs | signature mismatch | almost always a wrong app secret. Re-copy it. |
| Error `105005` | scope mismatch | client authorized before a scope was added; re-authorize that client |

Logs are in the Render dashboard under **Logs**. They are structured JSON and every secret is redacted before printing.

---

## What is deliberately not running yet

- **Live analytics** (viewer count, GMV ticker, minute-by-minute recap). The scopes exist on the app (`data.shop_analytics.public.read`, `creator.data.live.read.public`) but they are a different scope family from the `seller.*` ones, they do not appear in Manage API, and `live_room_id` has no confirmed source at stream start. Client methods are written and unused rather than guessing.
- **Blind box write-back**, the pull-result-to-buyer feature. Needs a version check first.
- **Topic 17** (shoppable content posting) is received and logged, not acted on.
