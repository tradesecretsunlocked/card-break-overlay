> ⛔ **SUPERSEDED 2026-07-30.** Replaced by `card-break-overlay/docs/SOP-CLIENT-PROVISIONING.md` plus `card-break-overlay/TSU-OVERLAY-STANDARD.md`. Archived during the documentation consolidation audit. Kept for history only. Do not use this file for current work.
>
> A live banner stub remains at `card-break-overlay/bridge/CLIENT-ONBOARDING.md` mapping each topic to its replacement.
>
> Everything below this line is the original text as of the archive date and is not maintained.

---

# TSU Client Onboarding — Step by Step

From zero to a live, tested client in one pass.

---

## Step 1 — Generate a bridge key

Open any browser tab and paste this in the console:

```js
crypto.randomUUID()
```

Copy the result. Example: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

Save it somewhere — Notion client profile, a note, anywhere. This is the only secret.

---

## Step 2 — Register the key in Supabase

1. Go to [supabase.com](https://supabase.com) → your project → **Table Editor** → `bridge_keys`
2. Click **Insert row**
3. Fill in:
   - `key` → paste the UUID you just generated
   - `client_name` → client's name (e.g. "Flatbill Sports")
   - `active` → `true`
   - `notes` → optional (e.g. "onboarded May 2026")
4. Save

That's it — the bridge will now accept this key. No server restart, no redeploy.

---

## Step 3 — Build the overlay

Use the TSU Overlay Agent skill in Cowork to build from the Notion queue, or do it manually:

1. Clone the closest source overlay to `overlays/_drafts/{client-slug}/index.html`
2. Apply branding edits (colors, logo, title)
3. The key goes in the overlay's **localStorage defaults** — it's set once by the client in the
   settings modal, or you can pre-bake it as a URL param for OBS:

   ```
   https://your-hosting.com/overlays/{client-slug}/index.html?key=THEIR_KEY
   ```

   OBS browser source URL = paste that full URL. Done. No manual setup needed by the client.

---

## Step 4 — Build the Chrome extension

1. Open `extension-UPDATED-04-14-2026/content.js`
2. Find the `DEFAULTS` block near the top:

```js
const DEFAULTS = {
  bridgeKey: "REPLACE_WITH_CLIENT_KEY",   // ← paste their key here
  sport: "nfl",
  overlayId: "{client-slug}",
  channel: "main",
  pollMs: 3000,
  summaryEvery: 5
};
```

3. Replace `REPLACE_WITH_CLIENT_KEY` with their UUID
4. Zip the entire `extension-UPDATED-04-14-2026/` folder
5. Name it `{client-slug}-extension.zip`
6. Send it to the client (or install it yourself if you manage their setup)

---

## Step 5 — Client installs the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked** and select the unzipped extension folder
   — OR drag and drop the zip (works in some Chrome versions)
4. The extension icon should appear in the toolbar

---

## Step 6 — Deploy the overlay

**Option A — OBS local file (simplest)**
- Give the client `index.html` + any asset files
- OBS browser source → Local File → point at `index.html`
- Append `?key=THEIR_KEY` in the URL field in OBS

**Option B — Hosted (recommended for Tier 2+)**
- Push to your hosting (GitHub Pages, Render static, Netlify, etc.)
- OBS browser source URL → `https://your-host.com/overlays/{slug}/index.html?key=THEIR_KEY`

---

## Step 7 — Test end to end

**Test 1 — Bridge accepts the key**

Paste in browser console:
```js
fetch("https://bridge.tradesecretsunlocked.com/status?key=THEIR_KEY")
  .then(r => r.json()).then(console.log)
// Expected: { key_prefix: "a1b2c3…", connections: 0 }
// If you get 403 → key not in Supabase or active = false
```

**Test 2 — Overlay connects**

Load the overlay URL in a browser tab (not OBS yet). Open DevTools → Console.
You should see: `[SSE] connected` or similar within 2 seconds.
Run the status check again — `connections` should now be `1`.

**Test 3 — Extension fires an event**

1. Open a Whatnot live stream (or any Whatnot page)
2. Click the extension icon → verify the bridge key shown matches
3. Make a test sale on Whatnot (or use the manual test below)

**Manual event test (no Whatnot needed):**
```js
fetch("https://bridge.tradesecretsunlocked.com/events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-bridge-key": "THEIR_KEY"
  },
  body: JSON.stringify({ type: "team_sold", code: "KC", buyer: "TestBuyer", channel: "main" })
}).then(r => r.json()).then(console.log)
```

The KC tile in the overlay should go sold. If it does, the full pipeline is working.

**Test 4 — Check Supabase logs**

Supabase → Table Editor → `bridge_events` → Refresh.
You should see the `team_sold` event logged with their bridge key.

---

## Revoking a client

1. Supabase → Table Editor → `bridge_keys`
2. Find their row → set `active` = `false` → Save
3. Within 5 minutes their SSE connections will be refused and new extension posts will be rejected
4. No redeploy needed

To re-activate: flip `active` back to `true`.

---

## Quick reference

| What | Where |
|---|---|
| Generate key | `crypto.randomUUID()` in any browser console |
| Register key | Supabase → `bridge_keys` table |
| Key in overlay | URL param `?key=` or localStorage settings modal |
| Key in extension | `DEFAULTS.bridgeKey` in `content.js` |
| Check bridge | `GET /status?key=THEIR_KEY` |
| Revoke | Set `active = false` in Supabase |
| Logs | Supabase → `bridge_events` table |
