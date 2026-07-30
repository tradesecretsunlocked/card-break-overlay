# Process Document: TSU Client Provisioning, Purchase to Deployed

**Owner:** Mike De (TSU Operations) | **Last Updated:** 2026-07-30 | **Review Cadence:** Quarterly

> **Read this first if you have never provisioned a TSU client.**
> Section 0 explains the system in plain language. Do not skip it. Every step
> after it assumes you understand the four moving parts named there.

---

## Purpose

This document is the single runbook for taking a Trade Secrets Unlocked (TSU)
customer from the moment they pay to the moment they are live on stream with a
working overlay. It exists so that any employee, with no prior knowledge of the
platform, can complete a provisioning end to end without guessing and without
having to work out which system holds the truth.

It replaces every earlier onboarding and workflow document. Anything that
contradicts this file is out of date.

## Scope

**In scope:** intake of a paid customer, creating their bridge key and portal
account, entitling their services, building their overlay, building their Chrome
extension, building their graphics, internal review, client review and approval,
scheduling and running the deployment appointment, and confirming they are live.

**Out of scope:**

- Building overlay HTML from scratch. Overlays are always clones of an approved
  reference. See `card-break-overlay/TSU-OVERLAY-STANDARD.md`.
- Ongoing support, troubleshooting and incident response. See
  `How to use Claude/TSU-Ops-Handbook/`.
- Billing collection, refunds and Stripe disputes.
- Sales and lead qualification before purchase.
- Marketing, ads and funnel work.

---

## 0. The system in plain language

There are four moving parts. Everything in this SOP touches one of them.

**1. The bridge.** One shared server at
`https://bridge.tradesecretsunlocked.com`. Every client uses the same URL. There
is no per client server. Older documents mention per client `onrender.com`
addresses: those are decommissioned and must never be used again.

**2. The bridge key.** A string, unique per client, stored in the Supabase table
`bridge_keys`. It is the only thing that separates one client's data from
another's. The key is baked into the client's overlay HTML and into their Chrome
extension at build time. Clients never see it, type it, or configure it.

**3. The overlay.** A single self contained HTML file, hosted, loaded in OBS as a
browser source. It subscribes to the bridge over SSE and updates itself when
sale events arrive.

**4. The extension.** A Chrome extension the client installs. It watches their
Whatnot or Loupe show and posts sale events to the bridge with their key in the
`x-bridge-key` header.

The flow, left to right:

```
Whatnot / Loupe page in Chrome
        |
        v
  TSU Chrome extension   (polls about every 3s, POSTs with x-bridge-key)
        |
        v
  bridge.tradesecretsunlocked.com   (validates the key against bridge_keys,
        |                            logs to bridge_events, broadcasts by key)
        v
  Overlay in OBS   (SSE subscriber, renders the sold tile)
```

The overlay is platform agnostic. It receives one canonical `team_sold` event
and cannot tell whether the sale came from Whatnot or Loupe. Only the extension
is platform specific.

### Where the truth lives

**The system of record is Supabase.** Specifically the `builds` table, surfaced
to staff in TSU HQ at `portal.tradesecretsunlocked.com/command-center`.

**Everything onboarding and provisioning touches is internal to Supabase and
HQ.** There is no external build queue, no external intake form, and no
external client database in this process. If you find a document that sends you
outside Supabase and HQ for queue, client or build data, that document predates
the current system: do not follow it, and report it for archiving.

Two names that sound alike and are not the same thing:

| Name | What it is |
|---|---|
| **TSU HQ** | Staff only admin surface. Where you work. `portal.tradesecretsunlocked.com/command-center` |
| **TSU Command Center** | The customer facing product the client logs into |

### The tables you will touch

| Table | What it holds | You will |
|---|---|---|
| `builds` | One row per overlay build. This is the queue. | Read and write status |
| `bridge_keys` | One row per client key | Create via automation |
| `client_services` | Per client feature entitlements | Create via automation |
| `client_billing` | Tier and subscription status | Create via automation |
| `client_settings` | Per client defaults | Create via automation |
| `client_users` | Links a portal login to a bridge key | Created via automation |
| `build_reviews` | Client review rounds, approval, TOS, deployment booking | Read and write |
| `crm_contacts` | Client profile. | Read |
| `crm_transactions` | What they bought. | Read |
| `bridge_events` | Raw event log. Diagnostics only. | Read only |
| `known_issues` | Structured registry of known bugs and their fixes | Read |

Do not sum `bridge_events` for revenue or sale counts. Raw event rows overcount
by roughly 60 percent. Use the views `v_sales`, `v_sales_daily` and
`v_break_pnl` instead.

---

## RACI Matrix

ARIA is the TSU automation agent. Most of this process is already automated and
runs without a person. Manual provisioning is the fallback path and, in practice,
is performed by the same operator each time.

| Step | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| 1. Intake, build row created | ARIA (webhook) | Mike | none | Operator |
| 2. Questionnaire collected | Client | Operator | none | ARIA |
| 3. Provision key and account | ARIA (`provision-client`) | Mike | none | Operator |
| 4. Verify entitlements and link | Operator | Mike | ARIA | none |
| 5. Select reference and build overlay | ARIA (overlay agent) | Mike | Operator | none |
| 6. Graphics | Operator | Mike | Client | none |
| 7. Build client extension | Operator | Mike | none | none |
| 8. End to end test | Operator | Operator | none | Mike |
| 9. Internal review | Mike | Mike | Operator | none |
| 10. Client review and approval | Operator sends, Client decides | Mike | none | ARIA |
| 11. Schedule deployment | Client books | Operator | none | Mike |
| 12. Build deployment package | Operator | Operator | none | none |
| 13. Deployment appointment and training | Operator | Mike | none | Client |
| 14. Close out and mark live | Operator | Mike | none | Mike |

**Escalate to Mike, and do not proceed, when:** a client asks for a layout change
that alters grid structure, anything would have to be deleted from production, a
client is to receive a file for the first time, or a step in this SOP does not
match what you actually see on screen.

---

## Process Flow

Stage numbers below are the HQ v2 build lifecycle. `builds.status` and
`builds.client_status` carry them.

```
 [0] Lead
      |  purchase (stan.store or Stripe)
      v
 [1] Awaiting Questionnaire ........ builds row exists, questionnaire_complete = false
      |  client submits questionnaire
      v
 [2] In Queue ...................... questionnaire_complete = true, slug confirmed
      |  provision  +  build overlay  +  graphics  +  extension
      v
 [3] Internal Review ............... draft in _drafts/, Mike reviews
      |                                    |
      |                                    +--> fails --> back to [2]
      v
 [4] Client Review ................. build_reviews row, preview sent
      |                                    |
      |                                    +--> revisions --> [5b] Revision --> [2]
      |  client approves and accepts TOS
      v
 [5a] Deployment Scheduled ......... build_reviews.deployment_call_at set
      |  package built, uploaded to Drive, appointment held
      v
 [6] Done ......................... overlay live in client OBS, training complete
      |  first successful live break
      v
 [7] Completed

  Any stage --> [h] On Hold       (client unresponsive, blocked on client)
  Any stage --> [x] Cancelled     (refund, churn before delivery)
```

---

## Detailed Steps

### Step 1: Intake, the build row is created

- **Who:** ARIA, automatically. No human action.
- **When:** the moment a customer pays.
- **How:** the customer buys through stan.store or directly through Stripe. The
  edge function `stan-order` or `stripe-webhook` fires, creates the `builds`
  row, and writes the customer into `crm_contacts` and `crm_transactions`. The
  `send-build-started` function emails the customer that their build has begun
  and stamps `builds.build_started_email_at`.
- **Output:** a `builds` row with `questionnaire_complete = false`.

**What you do:** nothing, but verify. Open TSU HQ and confirm the row appeared
within a few minutes of the purchase. If it did not, see "Intake did not fire"
under Exceptions.

**Tier mapping, for reference.** `stripe-webhook` maps the paid amount to a
tier: 2900 or 29000 to `pro`, 4900 or 49000 to `elite`, 1200 or 12000 to
`founding`. It never downgrades an account already marked `grandfathered`.

### Step 2: Questionnaire and slug

- **Who:** the client fills it in. Operator chases.
- **When:** immediately after purchase.
- **How:** the client receives the questionnaire link in the build started
  email. On submit, `submit-questionnaire` writes their answers onto the
  `builds` row: `default_sport`, `canvas_width`, `canvas_height`, `face_cam`,
  `camera_box`, `reference_urls`, `phone`, `extension_needed`,
  `graphics_needed`, and sets `questionnaire_complete = true`.
- **Output:** `builds.questionnaire_complete = true`.

**What you do:** if the questionnaire is not back within three business days,
send one reminder. After seven days, set the build to On Hold and tell Mike. Do
not start building without it. The questionnaire is where the canvas size and the
platform come from, and rebuilding for the wrong canvas wastes the whole build.

**Confirm the slug.** The slug is the short lowercase hyphenated client name used
in the overlay path, the extension zip name and the overlay URL, for example
`bigger-than-cardboard`. Agree it before anything is built, then set
`builds.slug_confirmed = true`. Changing a slug after deployment means re-cutting
the extension and re-importing OBS on the client's machine, so get it right once.

### Step 3: Provision the client, the primary automated path

- **Who:** ARIA. An admin operator can invoke it directly.
- **When:** as soon as the questionnaire is back and the slug is confirmed.
- **How:** call the Supabase edge function `provision-client`. This is the
  correct path. Do not hand write the SQL unless the function is unavailable.

`provision-client` is admin only. It requires a valid JWT and the caller must
exist in `app_admins`. It accepts POST only.

Request body:

| Field | Required | Default | Notes |
|---|---|---|---|
| `email` | yes | | **Must be the exact email the client will sign into the portal with.** See the warning below. |
| `client_name` | yes | | Display name, for example `Bigger Than Cardboard` |
| `tier` | no | `pro` | One of `local`, `pro`, `elite`, `custom`, `legacy` |
| `features` | no | `["hosting","automation"]` | Filtered against `service_catalog` |
| `bridge_key` | no | generated | Pass one only when migrating an existing client |
| `monthly_amount` | no | | Drives `subscription_status` |
| `grandfathered` | no | false | Forces `subscription_status = grandfathered` |
| `founding_member` | no | false | |
| `total_slots` | no | | Written to `client_settings.default_total_slots` |
| `send_invite` | no | true | Sends the portal invite email |
| `redirect_to` | no | `https://portal.tradesecretsunlocked.com` | Invite landing page |

What it writes, in order. Every write is an idempotent upsert, so re-running it
for the same client is safe and is the correct way to repair a partial
provisioning:

1. `bridge_keys`: `key`, `client_name`, `client_email` set from `email`,
   `active: true`
2. `client_billing`: `key`, `tier`, `subscription_status`, `monthly_amount`,
   `grandfathered`, `founding_member`
3. `client_settings`: `key`, `default_total_slots`
4. `client_services`: one row per feature, each with `entitled: true` and
   `enabled: true`
5. The auth account: reuses an existing user matching the email, otherwise
   invites, otherwise creates
6. `client_users`: links `user_id` to `bridge_key`

`subscription_status` is derived, not passed: `grandfathered` if the
grandfathered flag is set, else `active` if `monthly_amount` is greater than
zero, else `none`.

It returns `{ ok, bridge_key, user_id, invited, tier, status, features }`.
**Record the returned `bridge_key`.** You need it for the overlay, the extension
and every test that follows.

> ### The number one recurring provisioning bug
>
> `bridge_keys.client_email` must equal, exactly, the email address the seller
> signs into the portal with. It is not a label. A database trigger reads that
> column and links the seller's portal login to their client record on first
> sign in. If it is blank, or if it holds a different address than the one they
> actually use, the auto link silently fails and the client is stranded on
> "waiting to be linked" with no error explaining why.
>
> This has hit Quantum, 808, Dynasty and others. Treat `client_email` as
> required. Confirm the address with the client in writing before provisioning.
> If they later sign up with a different address, see "Portal auto link failed"
> under Exceptions.

**Key format.** `provision-client` generates a `crypto.randomUUID()` value, a 36
character UUID. Keys created before 2026 are 32 character hex strings.
`bridge_keys.key` is free text, so both formats are valid and neither needs
migrating. New keys are UUIDs. Never reformat an existing key.

> **`provision-client` does not create a `builds` row.** Provisioning the key
> and the account is a separate act from creating the build record. The build row
> comes from `stan-order`, `stripe-webhook` or `submit-questionnaire` at Step 1.
> If you provision a client and then wonder why no build appears in the queue,
> this is why: the purchase never fired. See "Intake did not fire".

- **Output:** a live bridge key, an entitled client, a portal invite sent. Set
  `builds.provisioned = true`.

### Step 3b: Manual provisioning, fallback only

Use this only when `provision-client` is unavailable. It is **not** equivalent to
the automated path. It differs in two ways, both flagged inline.

```sql
-- 1. the key. Generate a UUID. client_email is REQUIRED and must be the
--    portal login address.
insert into bridge_keys (key, client_name, client_email, active, notes)
values ('GENERATED_UUID', 'Client Display Name', 'their-login@email.com', true,
        'provisioned manually 2026-07-30, provision-client unavailable');

-- 2. entitlements. NOTE the difference: this grants portal as well.
--    provision-client grants only hosting and automation by default.
--    Grant portal only if the client is actually entitled to the portal.
insert into client_services (key, service, entitled, enabled) values
  ('CLIENT_KEY','hosting',true,true),
  ('CLIENT_KEY','automation',true,true),
  ('CLIENT_KEY','portal',true,true);

-- 3. billing
insert into client_billing (key, tier, subscription_status)
values ('CLIENT_KEY','pro','active');

-- 4. settings
insert into client_settings (key) values ('CLIENT_KEY');

-- 5. link the portal login. NOTE the difference: provision-client upserts
--    client_users directly instead of calling this function. Either works.
select tsu_link_user('their-login@email.com', 'CLIENT_KEY');
```

Record in `builds.agent_notes` that provisioning was manual and which features
were granted, so the difference is visible later.

Production database changes are **additive only**. Never delete or overwrite a
production row to fix a mistake. Insert a correction, or ask Mike.

### Step 4: Verify the provisioning before you build anything

- **Who:** Operator.
- **When:** immediately after Step 3, before any build work.
- **How:** four checks, in order. Ninety seconds of work that saves a rebuild.

1. `bridge_keys` has the row, `active = true`, and `client_email` matches the
   address the client confirmed.
2. `client_services` has one row per entitled feature, each `entitled` and
   `enabled`.
3. `client_billing` has the right tier and a sensible `subscription_status`.
4. `client_users` has a row joining their `user_id` to the bridge key. If it is
   missing, the auto link has simply not run yet: it fires on their first sign
   in.

Then confirm the bridge itself accepts the key. Paste this into any browser
console:

```js
fetch("https://bridge.tradesecretsunlocked.com/status?key=THEIR_KEY")
  .then(r => r.json()).then(console.log)
// Expected: { key_prefix: "a1b2c3...", connections: 0 }
```

A 403 means the key is not in `bridge_keys`, or `active` is false. A 401 means
you sent no key at all. Key validation is cached for about five minutes, so a key
you just inserted can take that long to be accepted. Wait, then retry once,
before treating it as a failure.

- **Output:** a provisioning you can build against with confidence.

### Step 5: Build the overlay

- **Who:** ARIA, the overlay agent. Operator reviews.
- **When:** after Step 4 passes.
- **How:** the full rules are in
  `card-break-overlay/TSU-OVERLAY-STANDARD.md`. What matters here:

**Rule one: new builds are clones of an approved reference with scoped surface
edits only.** Never build a layout from scratch. There are two layout families,
and the rule is consistency within a family, not across families:

| Family | Canonical reference |
|---|---|
| Divisions / Board | `overlays/how-you-doin/index.html` |
| Row grid | `overlays/legends-hobby/index.html` |

A style, colour or logo change is a surface edit: the grid structure stays
identical. Do not restructure a layout to satisfy a cosmetic request. Bring it to
Mike instead.

Non negotiable build rules:

- Write only to `_drafts/{client-slug}/index.html`. Never write directly into
  `overlays/`.
- Never modify the SSE automation logic while cloning.
- Never remove `soldTeams`, `soldTeamsList` or `lastCodeByListingKey`.
- Never rename the bridge localStorage keys.
- ES6 only. No CDN dependencies: OBS Chromium has no network access for external
  JS libraries.
- No `prompt()` and no `alert()`. Use the OBS safe modal pattern.
- Every SSE handler starts with the `breakIdMatches(data)` guard.
- Required features, always present and always visible: `soldFlash`, fallback
  image handling, the export modal, Reset, New Break, the sold stat, and
  Remaining.
- Visible colour contrast variance. No flat single colour designs. Use gradients
  deliberately, to draw the eye to the header, the ticker and the sold panel.
- One client's data never bleeds into another's.

Hardcode the bridge configuration. Both constants live at the top of the file:

```js
const BRIDGE_BASE = "https://bridge.tradesecretsunlocked.com";
const BRIDGE_KEY_DEFAULT = "<this client's key>";
function getBridgeBase(){ return (getParam('bridge') || BRIDGE_BASE).replace(/\/$/,''); }
function getBridgeKey(){  return getParam('key')    || BRIDGE_KEY_DEFAULT; }
```

The URL parameter override exists for your testing only. **Never hand a client an
overlay URL with the key in the query string as the deployment method.** The key
belongs in the file.

Bridge config must not be read from localStorage. Per client board state in
localStorage is correct and still required, namespaced `{client-slug}.keyName`
through a single `LS` constants object, never inline strings. The only cross
client localStorage keys are the bridge ones.

Two details that cause silent bugs if a clone drops them:

- **Sale dedup** keys on `saleId || id || listingId`, never on `productId`.
  `productId` identifies the break, not the sale.
- **Buyer uniqueness:** before assigning a buyer to a new team, unsell any team
  that buyer already owns.

- **Output:** `_drafts/{client-slug}/index.html`. Write back to the build row:
  `status = 'in_build'`, `stage_detail = 'Overlay draft staged for review'`,
  `action_needed = 'Review overlay draft'`, plus `source_template`, `output_file`
  and `bridge_key`. Do not use `status = 'review'`: that value is reserved for
  the client review feature.

### Step 6: Graphics, only if `graphics_needed`

- **Who:** Operator.
- **When:** in parallel with Step 5.
- **How:** check `builds.graphics_needed` first. Not every client buys graphics.
  Build to the canvas size and camera layout captured in the questionnaire
  (`canvas_width`, `canvas_height`, `face_cam`, `camera_box`). Use the client's
  `reference_urls` for their existing brand.
- **Output:** graphics files staged for the deployment package.

### Step 7: Build the client's Chrome extension, only if `extension_needed`

- **Who:** Operator.
- **When:** after the bridge key exists.
- **How:** check `builds.extension_needed` first. Then:

1. Copy the canonical template `extension-UPDATED-04-14-2026/` (currently
   v2.2.1). Never edit the template in place.
2. Open `content.js` and set the `DEFAULTS` block:

```js
const DEFAULTS = {
  bridgeUrl: "https://bridge.tradesecretsunlocked.com", // shared, same for ALL clients
  bridgeKey: "REPLACE_WITH_CLIENT_KEY",                 // unique per client
  sport: "nfl",       // "nfl" | "nba" | "mlb" | "nil"
  overlayId: "",      // e.g. "northland"
  channel: "main",
  pollMs: 3000,
  summaryEvery: 5
};
```

3. Zip the folder to `{client-slug}-extension.zip`.

Three values must match between the overlay and the extension or nothing will
appear on screen: the **bridge key**, the **channel** (the standard is `main`),
and the **overlay id**.

Live scores, if the client bought them, broadcast on a single `sports` channel
gated by `client_services.scores`. Two legacy clients still use per client
`sports-*` channels and are being migrated. New clients use `sports`. Never use
the deprecated `scoresChannel`.

> **Open live bug, check before you ship.** The canonical template's
> `host_permissions` still lists the legacy `https://*.onrender.com/*` and is
> **missing** `https://bridge.tradesecretsunlocked.com/*`. Verify the manifest in
> the copy you cut includes the bridge host. If you fix a client's extension,
> patch **both** the client's copy and the canonical template, otherwise the next
> build inherits the same bug.

- **Output:** `{client-slug}-extension.zip`.

### Step 8: End to end test, four parts

- **Who:** Operator.
- **When:** before internal review. Never skip this.
- **How:** run all four in order. Any failure stops the process.

**Test 1, the bridge accepts the key.**

```js
fetch("https://bridge.tradesecretsunlocked.com/status?key=THEIR_KEY")
  .then(r => r.json()).then(console.log)
// Expected: { key_prefix: "a1b2c3...", connections: 0 }
```

**Test 2, the overlay connects.** Open the overlay URL in a plain browser tab,
not in OBS. The DevTools console should print `[SSE] connected` within about two
seconds. Re-run Test 1: `connections` should now read 1.

**Test 3, an event lands.** With the overlay still open, POST a manual sale. No
Whatnot or Loupe session is needed.

```js
fetch("https://bridge.tradesecretsunlocked.com/events", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-bridge-key": "THEIR_KEY" },
  body: JSON.stringify({ type: "team_sold", code: "KC", buyer: "TestBuyer", channel: "main" })
}).then(r => r.json()).then(console.log)
```

The Kansas City tile should go sold, with the sold flash animation, and both the
sold count and Remaining should update.

**Test 4, it was logged.** Open the `bridge_events` table in Supabase and confirm
the `team_sold` event is recorded against this client's key.

Then reset the board, so the client is never sent a preview with TestBuyer owning
Kansas City.

- **Output:** a working, verified overlay and extension pair.

### Step 9: Internal review

- **Who:** Mike.
- **When:** after Step 8 passes.
- **How:** the draft sits at `_drafts/{client-slug}/index.html` with
  `status = 'in_build'` and `action_needed = 'Review overlay draft'`. Mike checks
  layout fidelity against the reference, colour contrast, the required features,
  and that no automation logic drifted during the clone.

Nothing is delivered to a client without Mike's approval. That is absolute.

Once approved, promote the draft from `_drafts/{client-slug}/` to
`overlays/{client-slug}/`, and record the hosted address in
`builds.overlay_url`.

- **Output:** an approved, hosted overlay.

### Step 10: Client review and approval

- **Who:** Operator sends. The client decides.
- **When:** after internal approval.
- **How:** create a `build_reviews` row for this build. That row, not an email
  thread, is the record of the review round:

| Column | Meaning |
|---|---|
| `build_id`, `round` | Which build, which round of review |
| `preview_urls` | What the client was shown |
| `message`, `sent_at`, `sent_to` | The outbound note |
| `decision`, `notes`, `decided_at`, `decided_by_email` | Their answer |
| `tos_version`, `tos_accepted_at` | Terms acceptance. This gates deployment. |
| `booking_url`, `deployment_call_at` | The scheduling link and the booked slot |

Alongside the preview, do the pre appointment prep:

- Create or confirm the client's Google Drive project folder, and record it in
  `builds.drive_link`.
- Upload the Prep Instructions Packet to that folder.
- Send the client facing note: their overlay is built and going through internal
  review and testing, a project folder exists in Google Drive, prep instructions
  are already in it, and they need OBS downloaded and ready before the deployment
  appointment.

If the client asks for revisions, set the build to Revision, return to Step 5,
and open a **new** `build_reviews` round rather than editing the old one. Surface
edits only: a structural request goes to Mike.

- **Output:** `decision` recorded, `tos_accepted_at` stamped.

### Step 11: Schedule the deployment appointment

- **Who:** the client books, using `build_reviews.booking_url`.
- **When:** after approval and TOS acceptance.
- **How:** the booked time is stored in `build_reviews.deployment_call_at`. Do
  not schedule before `tos_accepted_at` is populated. Calendar automation sends
  the reminder.
- **Output:** `deployment_call_at` set. Build moves to Deployment Scheduled.

### Step 12: Build the deployment package

- **Who:** Operator.
- **When:** before the appointment, not during it.
- **How:**

1. Open OBS on the build machine.
2. Add the client's hosted overlay URL as a browser source, at the canvas size
   from the questionnaire.
3. Configure the scene layout: graphics, camera box, alerts.
4. Export the **Scene Collection** as a `.json` file.
5. Export the **Profile** as an `.ini` folder.
   *(CONFIRM WITH OWNER: is the Profile export still part of the package, or is
   the Scene Collection alone sufficient now?)*
6. Upload to the client's Google Drive folder, the one recorded in
   `builds.drive_link`: the Scene Collection `.json`, the Profile folder, the
   `{client-slug}-extension.zip` from Step 7, the graphics from Step 6, and the
   supporting documents.

- **Output:** everything the client needs, sitting in their Drive folder before
  the call.

### Step 13: The deployment appointment

- **Who:** Operator, with the client.
- **When:** at `deployment_call_at`.
- **How:** deployment means the client ends the call able to run a break
  unaided. Work down the list.

**Get the files onto their machine.** Walk them through downloading their files
from the Google Drive folder. Then take remote access to their computer to do the
installs. Drive is the handoff, remote access is the install.

**Install, on their machine:**

1. Import the OBS Scene Collection.
2. Import the OBS Profile.
3. Install the Chrome extension: open `chrome://extensions`, enable Developer
   Mode with the toggle at the top right, choose Load unpacked, select the
   unzipped extension folder, confirm the extension icon appears in the toolbar,
   then click the icon and verify the bridge key shown matches theirs.

**Confirm it works, on their machine, not yours:**

4. The overlay is visible in OBS and shows an SSE connection.
5. The extension is firing events. Run the Step 8 Test 3 POST and watch their
   overlay respond. Reset the board afterwards.

**Train them.** This is the part that determines whether they succeed:

6. Going live: starting a break, the New Break flow, Reset, and what the sold
   stat and Remaining are telling them.
7. Using OBS: switching scenes, the browser source, and what to do if the overlay
   goes blank (refresh the browser source cache).
8. Using the overlay day to day, including the export modal.
9. Point them at the Troubleshooting Guide and the support documentation, and
   tell them how to reach support.

- **Output:** a client who is live and trained.

### Step 14: Close out

- **Who:** Operator.
- **When:** immediately after the appointment.
- **How:** write the build row to Done, with `stage_detail` recording what was
  delivered and any follow ups. Confirm `overlay_url`, `drive_link` and
  `bridge_key` are all populated on the row. Note anything unusual in
  `agent_notes`.

After their first successful live break, move the build to Completed. Check
`v_overlay_health` for their key: it should read `live` during a show and `idle`
between shows.

- **Output:** a closed build and a live client.

---

## Exceptions and Edge Cases

| Scenario | What to Do |
|---|---|
| **Intake did not fire.** Customer paid, no `builds` row. | Check whether they are a returning customer. Historically the stan.store trigger fired only for new customers, so a second purchase created nothing. `stripe-webhook` and `stan-order` are both live now and this is believed closed. *(CONFIRM WITH OWNER.)* In the meantime: create the build row by hand from `crm_transactions`, and report it so the trigger gets fixed. |
| **Portal auto link failed.** Client sees "waiting to be linked." | `bridge_keys.client_email` does not match their actual login. Repair with `update bridge_keys set client_email='their-real-login@email.com' where key='CLIENT_KEY';` then `select tsu_link_user('their-real-login@email.com', 'CLIENT_KEY');` Have them sign out and back in. |
| **403 from the bridge.** | The key is not in `bridge_keys`, or `active = false`. Check both. Validation is cached about five minutes, so a brand new key needs a moment. |
| **401 from the bridge.** | No key was sent at all. The `x-bridge-key` header is missing, which usually means the extension `DEFAULTS.bridgeKey` was never filled in. |
| **Phantom 403s from a client who is not streaming.** | An abandoned OBS browser source is still trying to subscribe with a revoked key. The fix is to add that key to `QUIET_SUBSCRIBE_KEYS` on the bridge: its SSE GET is then accepted as an idle connection receiving zero events, while POST is still rejected. Ask Mike, this is a bridge config change. |
| **Overlay blank in OBS but fine in a browser.** | Refresh the browser source cache in OBS. If it persists, confirm the source URL is the hosted address and not a local file. Local file deployment is not supported. |
| **Extension installed but no events.** | Check the manifest `host_permissions` includes `https://bridge.tradesecretsunlocked.com/*`. This is the known template bug called out in Step 7. |
| **Sale counts look about 60 percent too high.** | Someone is counting raw `team_sold` rows. A sale is `saleId`, a break is `productId`, a stream is `liveId`. Take the latest event per `saleId`. Use `v_sales` and `v_sales_daily`, never raw `bridge_events`. |
| **A buyer appears to own two teams.** | Correct behaviour is: before assigning a buyer to a new team, unsell any team that buyer already owns. If it is not happening, the clone dropped the buyer uniqueness rule. |
| **Client wants a structural layout change.** | Stop. Escalate to Mike. Grid structure never changes at runtime, and clones are surface edits only. |
| **Client goes quiet.** | One reminder at three days, On Hold at seven, tell Mike. Do not build against a stale questionnaire. |
| **Offboarding or non payment.** | `update bridge_keys set active=false where key='CLIENT_KEY';` Effective within about five minutes. No redeploy needed. Flip back to `true` to reactivate. Never delete the row. |
| **`provision-client` errors or is unavailable.** | Use the Step 3b manual SQL, and note in `builds.agent_notes` that provisioning was manual and which features were granted. Re-run `provision-client` later to reconcile: every write is an idempotent upsert. |
| **Partial provisioning, some tables written and some not.** | Re-run `provision-client` with the same body. It upserts, so this is the intended repair and is safe. |
| **You find a document that sends you outside Supabase and HQ for the build queue.** | It is stale. Do not follow it. Report it so it gets archived and bannered. |
| **A bug you have seen before.** | Check the `known_issues` table first. It carries a confirming query, a client safe action, a playbook reference, and whether the client can fix it themselves. |
| **An overlay you were told to clone looks unusual.** | Some live overlays are one off outliers and must never be used as a reference. Clone only from the two canonical references in Step 5. |

---

## Metrics

| Metric | Target | How to Measure |
|---|---|---|
| Purchase to questionnaire returned | under 3 business days | `builds.created_at` to the timestamp `questionnaire_complete` flips |
| Questionnaire to internal review | under 5 business days | `builds` history to the first `build_reviews.sent_at` |
| Purchase to live | under 14 calendar days | `builds.created_at` to the Completed transition |
| Client review rounds per build | 1.0, never more than 2 | count of `build_reviews` rows per `build_id` |
| Provisionings needing manual SQL | 0 | count of builds whose `agent_notes` record a manual provisioning |
| Keys with a blank `client_email` | 0 | audit `bridge_keys` for null or empty `client_email` |
| Keys provisioned with no build row | 0 | `bridge_keys` rows with no matching `builds` row |
| Deployment appointments needing a follow up call | under 10 percent | follow up notes in `builds.stage_detail` |
| Overlay health after go live | `live` during shows | `v_overlay_health` for the client's key |

---

## Open items for the owner

Three points in this SOP are written from the archived workflow documentation and
need confirmation. They are marked inline as CONFIRM WITH OWNER.

1. **Google Drive plus remote access.** Step 13 assumes both: Drive is the file
   handoff, remote access is the install. `builds.drive_link` exists in the live
   schema, which supports Drive still being real. Confirm.
2. **Returning customer intake.** The old workflow said the stan.store trigger
   fired only for new customers. Both `stripe-webhook` and `stan-order` are now
   live, so this is believed closed. Confirm before the workaround is removed.
3. **The OBS Profile export.** Step 12 includes it. Confirm it is still part of
   the package rather than the Scene Collection alone.

Four audit queries could not be run from the session that produced this document
and are worth running once:

```sql
-- 1. the number one bug, quantified
select count(*) from bridge_keys where client_email is null or client_email = '';
-- 2. which lifecycle values are actually in use
select status, count(*) from builds group by 1 order by 2 desc;
select client_status, count(*) from builds group by 1 order by 2 desc;
-- 3. the feature catalogue and what clients can self serve
select * from service_catalog;
-- 4. provisioning backlog
select count(*) from builds where provisioned = false;
```

---

## Related Documents

| Need | Read |
|---|---|
| How to build an overlay, extension or key | `card-break-overlay/TSU-OVERLAY-STANDARD.md` |
| Repo orientation and agent rules | `card-break-overlay/CLAUDE.md` |
| Current verified state of the platform | `TSU-MEMORY.md` |
| Why a decision was made | `memory/DECISIONS-LOG.md` |
| Target architecture | `memory/HQ-v2-DESIGN.md` |
| Support and troubleshooting | `How to use Claude/TSU-Ops-Handbook/` |
| Known bugs, structured | Supabase table `known_issues` |

Retired, do not use: `bridge/CLIENT-ONBOARDING.md`, `docs/WORKFLOW.md`,
`docs/MANUAL-UPDATES-NEEDED.md`, `STANDARDS.md`,
`OBS Overlay Automation + Bot deployment/TSU-SYSTEM-STANDARDS.md`,
`TSU-OVERLAY-CODE-STANDARD.md`, `TSU-Onboarding-Flow.md`, and everything under
`archived/2026-07-30-doc-consolidation/`.
