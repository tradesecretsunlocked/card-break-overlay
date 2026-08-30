# TSU Whatnot Data and Deployment Spec

**Status:** APPROVED by Mike 2026-08-30. **PHASE 0 IS SHIPPED** (see the Phase 0 record below).
Parts A and B beyond Phase 0 are still unbuilt.
**Author:** Aria, 2026-08-30
**Supersedes:** nothing. **Amends:** `TSU-OVERLAY-STANDARD.md` §7 and §8, `docs/SOP-CLIENT-PROVISIONING.md` §7.
**Canon note:** where this doc and a skill reference file disagree, this doc wins until the
Standard and the SOP are updated to match.

---

## Why this exists

Two capabilities, one shared foundation.

1. **Historical seller financials.** Whatnot exposes fees, shipping costs, payouts and per-show
   analytics through the seller's own authenticated session. We currently capture gross sale price
   and nothing else, so every net-profit number in the portal is an estimate.
2. **Deployment that does not need a remote-control session.** 29 divergent extension builds exist
   on disk, 20 of them with no seller ownership gate. That is unmaintainable and it is a live risk.

The foundation both need is the same: **one extension, configured from the server, updated
centrally.**


---

## PHASE 0 RECORD, shipped 2026-08-30

**One deliberate deviation from the approved spec.** B2 said the config endpoint would live on the
bridge. It shipped as a **Supabase Edge Function**, `extension-config`, instead. Two reasons: the repo
copy of the bridge carries a banner saying it is stale and NOT deployed, so editing it could not be
verified, and the deployed bridge lives on Render which this session cannot deploy to. The edge
function was deployable and testable immediately. The contract is otherwise exactly as specified, and
the bridge stays focused on SSE.

**Endpoint:** `GET https://znyryhgjghjsobkzyfbx.supabase.co/functions/v1/extension-config`
Headers: `x-bridge-key` (required), `x-ext-version` (optional, telemetry).
`verify_jwt` is off; the bridge key is the credential.

| Case | Result |
|---|---|
| Valid active key | `200` with the full config |
| Missing key | `401 missing_bridge_key` |
| Unknown, inactive or archived key | `403 invalid_or_revoked_bridge_key` |
| Valid key, no config row | `200 configured:false, capture_enabled:false` |

Unknown and revoked return the **same** body on purpose, so a bad key learns nothing about whether it
exists. `capture_enabled` requires BOTH the kill switch and a real lowercase handle, and
`capture_blocked_reason` says which one failed. All four cases verified live.

**Table:** `client_extension_config`, one row per bridge key. Columns per B2 plus `ring`,
`capture_enabled`, `min_ext_version`, `source_build_path`, and telemetry
(`last_seen_at`, `last_seen_version`, `last_seen_count`). Constraints enforce lowercase handles, a
valid sport, a valid ring, and `channel = 'main'`. RLS: admins full access, a client may read only
their own row. Additive; nothing was altered or dropped.

**Telemetry is new capability.** Every config fetch records the reporting extension version, so
"which build is each client actually running" becomes a query. That was unanswerable before, and it
is what made the 2026-08-30 Wizards mixup take an hour.

### Seed result, which is the fleet audit

82 rows, one per active bridge key. From the 29 builds on disk, 15 carried a real UUID key; the newest
build per key won. Handles were then backfilled from `bridge_keys.whatnot_handle`, falling back to
`crm_contacts.business_name`, accepting only values already lowercase and space-free.

| | count |
|---|---|
| Config rows total | 82 |
| Fully ready (handle + overlay id) | 13 |
| **Missing a Whatnot handle** | **55** |
| Missing an overlay id | 67 |

**Two findings from the seed:**

- `Jim and Tabby` (`469c3440`) has a build on disk but the key is `active = false`. The endpoint
  correctly refuses it. Retired client, stale build; safe to archive the folder.
- `Northland Breaks Stream 2` (`a22c0803`) is active with a build and **no handle anywhere** in the
  database. It needs one before it can capture.
- The backfill picked up `doghouse_breaks` and other underscored handles intact. Under the old
  "strip non-alphanumeric" rule every one of those would have been silently mangled.

**The 55 missing handles are the Phase 2 backlog, in priority order.** Those clients cannot capture
under the config model until a handle exists, which is the correct fail-closed behaviour and also the
reason the migration is worth doing.

---

# PART A — WHATNOT DATA INGEST

## A1. Endpoint catalogue

All captured live from a seller's own session, 2026-08-30. All are the seller's own data.

| Operation | Shape | What it uniquely gives | Role |
|---|---|---|---|
| `getSellerReportDetailsPaginated` | cursor, `totalCount` | S3 object keys for **pre-generated CSV.gz** reports, weekly (`earnings-and-costs-v3`) and monthly (`statements_v2`) | **Bulk history. The single most valuable endpoint.** |
| `me.ledgerTransactions` | cursor, 20/page | Every money movement: `SALES`, `PAYOUT`, `ADJUSTMENT`, `SELLER_REFERRAL`, signed cents, linked to `order.id` and `listingId` | **Money spine and source of truth** |
| `SellerHubGetMyOrders` | cursor, 20/page | Order and item context, buyer username, listing title, status | Order dimension |
| `GetOrderReceipts` | per order **item** | Commission, payment processing, shipping, total fees, net earnings, `isPaidOut` | Fee detail, spot-check only |
| `GetShipments` | per shipment | `sellerPaidShippingCost`, weight, dimensions, courier, tracking, label URL, buyer address | Logistics |
| `MyPayouts` | cursor | Payout amounts, status, `type: stripe`, eta | Cross-check against ledger `PAYOUT` |
| `AnalyticsOverview_GetSellerAnalyticsLivestreams` | `limit: 30` | 22 metrics **per show in one call**, including promo spend | Per-show analytics |
| `GetAdsInsightSummary` | per livestream | Spend split boosts vs promotions, impressions time series at 9-minute intervals | Promo detail |
| `GetAdsROIMetricsForPromotedLive` | named metric list | Sales from promotions, return on spend, first-time buyers, follows, bids, 7 and 30 day RoS | Promo ROI |

## A2. The request-budget insight

Mike's constraint was explicit: pull history **without thousands of requests**.

`getSellerReportDetailsPaginated` solves it. Whatnot already generates the reports; we only fetch
them.

Worked example, a seller with 5,000 orders over two years:

| Approach | Requests |
|---|---|
| Orders list + a receipt call per item | 250 + 5,000 = **~5,250** |
| Monthly reports: list + download | 2 + 24 = **~26** |

**So: reports for history, ledger for the money spine, receipts only for recent orders or a
spot-check.** Do not build a receipt-per-item backfill.

**Missing piece to capture next.** `objectIds` are S3 keys, not URLs. The seller hub must call a
companion query to mint a presigned download URL. Capture that operation from the network tab when
clicking Download on a report. Until we have it, Part A history is blocked; everything else is not.

## A3. Data traps, all verified against Mike's captures

These are the difference between correct analytics and confidently wrong ones.

**1. `MyOrder.total` is not the order total.** Observed `total: 639` on an order whose real total is
`1939`. `1300 subtotal + 114 taxes + 525 shipping = 1939`, and `114 + 525 = 639`. The field appears
to mean buyer-paid extras. **Never use it as revenue.** Compute, or read `orderTotal` from the
receipt.

**2. Cancelled orders still report earnings.** A cancelled order carried
`netEarnings: "$17.35"` while `adjustedEarningsDetails.netAdjustedEarnings` was `"$0.00"` and the
badge read "Earnings Cancelled". Summing `netEarnings` books revenue that never existed. Always gate
on `earningsStatus` and `adjustedEarningsDetails`. `Expired` is another non-revenue state.

**3. Two money formats.** Orders, shipments, ledger and ads return **integer cents**. The receipt
endpoints return **display strings** (`"$13.00"`, `"-$1.04"`). Parse them, but store the raw string
alongside the parsed cents so a bad parse is auditable. Any non-USD seller will break a naive parser.

**4. Shipping cost can live in the ledger, not the shipment.** The sample shipment reported
`sellerPaidShippingCost: $0.00`, while the ledger held
`ADJUSTMENT −415, "Whatnot platform charge for shipping adjustment on Shipment #267237263"`.
**The ledger is authoritative for money. The shipment is authoritative for logistics.**

**5. Return on Spend is a ratio, not a percent.** `percentageValue: 0.5739` with spend `5750` and
sales `3300` is `0.57x`, meaning the seller **lost money**. Rendering "57.39%" invites the opposite
read. Display as `0.57x` and colour below `1.0x` as negative. Note also that 7-day and 30-day RoS
were identical to the base figure, so treat them as possibly stale on older shows.

**6. Ads metrics are a named list, not typed fields.** `metricResults[].name` is a display string
("Sales from Promotions"). Whatnot can rename these and our parser breaks **silently**. Key
defensively, store the raw array, and alert when an expected name goes missing rather than writing a
zero.

Also seen: `estimatedClickthroughRate: null` and `maxImpressionValue: 0` alongside 788 impressions.
Treat those two fields as unreliable.

## A4. Cross-check that validates the model

The Playmat order reconciles perfectly across three independent endpoints:

- receipt `netEarnings` `"$11.10"`
- ledger `SALES` `amount: 1110` referencing the same `order.id`
- order `subtotal 1300`, fees `-190`

**`1300 − 104 commission − 86 processing = 1110`.** The ledger is trustworthy and self-consistent.
Use this exact reconciliation as the ingest's automated correctness test.

## A5. Storage

`cmd_sales` already has `gross_price, platform_fee, shipping, cost_basis, net_profit, source,
external_id`. The destination was designed. New tables needed:

- `wn_ledger` — the spine. `bridge_key, txn_id, type, amount_cents, currency, status, created_at,
  completed_at, order_id, listing_id, message, raw jsonb`. Unique on `(bridge_key, txn_id)`.
- `wn_orders` — order and item dimension, unique on `(bridge_key, order_item_id)`.
- `wn_shipments` — logistics. **No address lines.**
- `wn_show_metrics` — one row per livestream from the analytics call.
- `wn_promo_metrics` — ads spend and ROI per livestream, plus `raw jsonb`.
- `wn_ingest_state` — per key and per source: cursor, last run, status, error. Makes every job
  resumable.

Every table keeps `raw jsonb` of the source node. Schema drift is guaranteed; keeping the raw
payload means a reprocess never needs to re-fetch.

## A6. PII

`GetShipments` returns full street addresses. **We store city, state, postal code and country only.**
Address lines and phone are dropped at ingest, not filtered later. That preserves every geographic
insight we would actually use and removes the bulk of breach exposure.

Buyer username is retained; it is the join key for buyer analytics and is already public on Whatnot.

Existing TSU customer-data and retention policy applies unchanged. Two additions are required before
this ships to clients: **a disclosure of what we collect from their Whatnot account, and a per-client
opt out** that disables ingest without disabling automation.

---

# PART B — DEPLOYMENT AND PER-CLIENT CONFIG

## B1. Current state, measured 2026-08-30

29 extension builds on disk:

| | count |
|---|---|
| **No seller ownership gate** | **20** |
| No `sendUnresolved` | 19 |
| Still on legacy `onrender.com` bridges | 3 |
| On v1.0.0 | 11 |

Versions span 1.0.0 to 2.3.4. Twenty builds can capture any Whatnot show the seller has open, which
is the 2026-08-11 incident (89 of 112 shows belonging to other sellers) waiting to recur.

**This inventory is the legacy cleanup list and the migration backlog. Same list.**

## B2. Target architecture

One extension. The only per-client value baked at install is the **bridge key**. Everything else is
fetched.

**Config endpoint:** `GET /extension-config` on the existing bridge, authenticated by the
`x-bridge-key` header the bridge already validates. No new auth surface.

Returns: `seller_username`, `overlay_id`, `sport`, `send_unresolved`, `poll_ms`, `features` jsonb,
`ring`, `capture_enabled`.

**Startup contract:**

1. No key → visible "not paired" state. Capture disabled.
2. Key present → fetch config, cache in `chrome.storage.local`, run.
3. **Fetch fails → run from the last cached config.** A bridge outage must never kill a live show.
4. No `seller_username` in config → capture disabled, fail closed, unchanged from today.
5. `capture_enabled: false` → **server-side kill switch.** Stops a misbehaving client without
   shipping code.

### Why this does not violate Standard §8

§8 forbids localStorage as the primary source because **page-writable** storage on whatnot.com can be
poisoned by anything running on that origin, and a stale key silently joins another client's scope.

A config delivered over HTTPS from our own bridge, authenticated by the client's own secret, is a
different trust class. The rule's intent, *the client's identity must not come from somewhere an
attacker or a stale session can write*, is preserved. What changes is where the trusted value
originates.

**Required amendment to §8:** baked constants remain the deployment method for the **bridge key**.
Everything else may come from the authenticated config endpoint, with page-writable storage still
banned as a source for any of it.

## B3. Edge cases and subset updates

**Per-client differences become config, not code.** `sendUnresolved`, `sport`, custom title rules and
matcher overrides all move into `features`. A client needing bespoke matching gets a rules array, not
a fork. Genuinely bespoke *code* should be treated as a smell and resisted.

**Release rings.** The `update_url` lives in the installed manifest, so the installer decides a
client's channel: `ring0` is Mike's own test account, `ring1` a handful of friendly clients, `ring2`
everyone. Versions are promoted through rings.

**Rings are not optional.** Today a bad zip hurts one client. With auto-update a bad push hits every
client at once, possibly mid-break. Rings plus the `capture_enabled` kill switch are day-one
requirements.

## B4. Installer

Decision, Mike 2026-08-30: **skip code signing for now.** Signed installers cost roughly $99/yr
(Apple Developer Program) plus a few hundred a year for a Windows certificate, and that is not
justified until the process is smooth and revenue is consistent.

**Interim, both platforms, unsigned:**

- **Windows** — a `.bat` that writes the Chrome external-extension registry keys under
  `HKCU\Software\Google\Chrome\Extensions\<id>` pointing at our self-hosted update URL, and writes
  the bridge key. SmartScreen will warn; the client clicks through.
- **macOS (30% of the fleet)** — a `.command` that writes
  `~/Library/Application Support/Google/Chrome/External Extensions/<id>.json` containing
  `external_update_url`, then writes the bridge key. Gatekeeper will warn; the client
  right-clicks and chooses Open.

Both are one file, one double-click, plus one warning to click through. Both auto-update afterwards.

**Upgrade path when it is justified:** the same scripts become a signed `.msi` and a notarized
`.pkg`. Nothing else about the design changes, so this is a packaging swap, not a rewrite.

## B5. Migration, merged with the legacy cleanup

- **Phase 0** — build the config table and endpoint, seed it from the 29-build inventory. This is
  simultaneously the legacy audit. No client change.
- **Phase 1** — ship v3, which prefers server config and falls back to baked constants when present.
  Every existing install keeps working.
- **Phase 2** — move clients onto the installer, ring by ring. **Start with the 20 builds that have
  no seller gate**, since those are the actual risk.
- **Phase 3** — retire per-client baked builds.

Phases 0 and 1 are worth doing even if the installer is never shipped, because they end the
divergence problem on their own.

---

# PART C — CANON CHANGES REQUIRED

| Document | Change |
|---|---|
| `TSU-OVERLAY-STANDARD.md` §8 | Amend as B2. Bridge key stays baked; other config may come from the authenticated endpoint; page-writable storage stays banned |
| `TSU-OVERLAY-STANDARD.md` §7 | Add the config model and rings; note that per-client values stop being baked at Phase 3 |
| `docs/SOP-CLIENT-PROVISIONING.md` §7 | Replace "bake five values" with "create the config row and hand over the installer", once Phase 2 starts |
| `tsu-overlay-agent` skill, Step 6b | Same. **Do not change until Phase 1 ships**, or the skill will describe a system that does not exist |
| New | Ingest runbook, once Part A is built |

**These are deliberately not applied yet.** Documenting an unbuilt system as though it exists is how
the "template still unfixed" error happened on 2026-08-29. They land as each phase ships.

---

# OPEN QUESTIONS FOR MIKE

1. **The report download operation is not yet captured.** Click Download on a seller report and grab
   the network call. Part A history is blocked until then.
2. **Spec approval.** Everything above is a draft.
3. **Test posture.** Recommend proving the full ingest on Mike's own seller account before any client
   data is touched.
4. **Disclosure and opt-out wording** needs drafting before client rollout.
5. **`.gitignore` still hides canon.** `docs/`, `CLAUDE.md`, `TSU-MEMORY.md` and `extension-template/`
   are all untracked. Proposed fix is in `DECISIONS-LOG.md` 2026-08-30, awaiting a yes or no.

---

## Sequencing recommendation

**Phase 0 first**, this week. It needs no certificates, no client contact and no Whatnot access, it
turns the fleet cleanup into a query, and it is the shared foundation for both halves of this spec.

In parallel, build the ingest against Mike's own account, since the shapes are already captured and
no client is exposed.
