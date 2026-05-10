# TSU Multi-Tenant Bridge

One Render web service replaces every individual per-client bridge.  
Routing is handled by **bridge key** — each client's 32-char hex key is their isolated namespace.

---

## Deploy to Render (first time)

### 1. Create the Web Service

1. Log in to [render.com](https://render.com)
2. **New → Web Service**
3. Connect your GitHub repo (`card-break-overlay`)
4. Set **Root Directory** → `bridge`
5. Set **Build Command** → `npm install`
6. Set **Start Command** → `node server.js`
7. Set **Instance Type** → **Starter ($7/month)** — this gives you an always-on dyno with no cold starts
8. Click **Create Web Service**

### 2. Set Environment Variables

In the Render dashboard → **Environment** tab, add:

| Key | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon key |
| `ESPN_ENABLED` | `true` (or `false` to disable score polling) |

> `PORT` is set automatically by Render — do not set it manually.

### 3. Custom Domain (optional but recommended)

1. In Render → **Settings → Custom Domains**
2. Add `bridge.tradesecretsunlocked.com`
3. Add the CNAME record shown to your DNS provider (Cloudflare, Namecheap, etc.)
4. Wait for SSL to provision (~5 min)

---

## Supabase Setup

Run this SQL in your Supabase project's **SQL Editor** to create the event log table:

```sql
create table if not exists bridge_events (
  id          bigserial primary key,
  bridge_key  text        not null,
  channel     text        not null default 'main',
  event_type  text        not null,
  payload     jsonb,
  occurred_at timestamptz not null default now()
);

-- Index for per-client queries
create index on bridge_events (bridge_key, occurred_at desc);
```

---

## API Reference

### SSE Subscribe (overlay → bridge)

| Format | URL |
|---|---|
| 218-style hosted | `GET /stream?channel=main&key={bridgeKey}` |
| Events alias | `GET /events?channel=main&key={bridgeKey}` |
| Flatbill-style draft | `GET /?key={bridgeKey}&channel=main` |

**Key can also be passed as a header:** `x-bridge-key`, `x-api-key`, or `Authorization: Bearer {key}`

### Publish (Chrome extension → bridge)

```
POST /events
Headers:
  Content-Type: application/json
  x-bridge-key: {bridgeKey}
Body:
  { "type": "team_sold", "channel": "main", "code": "ARI", ... }
```

Alias: `POST /event`

Response: `{ "ok": true, "channel": "main", "listeners": 3 }`

### Health Check

```
GET /health
→ { "status": "ok", "uptime": 3600, "clients": 12, "ts": 1234567890 }
```

### Per-Key Status

```
GET /status?key={bridgeKey}
→ { "key_prefix": "2a3d32…", "connections": 2 }
```

---

## Migrating Existing Clients

For each client currently on their own Render service:

1. Get their `bridgeKey` from the old service's `BRIDGE_KEY` env var (or from your Notion build queue)
2. The **overlay** only needs one URL change — update the `?bridge=` query parameter:
   ```
   Old: ?bridge=https://tsu-bridge-clientname.onrender.com
   New: ?bridge=https://bridge.tradesecretsunlocked.com
   ```
3. The **Chrome extension** `DEFAULTS.bridgeUrl` also needs updating — or push a new extension build with the shared URL
4. Test SSE connection via browser console:
   ```js
   const es = new EventSource("https://bridge.tradesecretsunlocked.com/stream?channel=main&key=YOUR_KEY");
   es.onmessage = e => console.log(JSON.parse(e.data));
   ```
5. Once confirmed working → delete the old Render service (saves $7/month per client)

---

## Architecture

```
Chrome Extension
  │  POST /events
  │  x-bridge-key: {clientKey}
  ▼
┌─────────────────────────────────────────┐
│  TSU Multi-Tenant Bridge (Render $7/mo) │
│                                         │
│  Map<bridgeKey → Map<channel → Set<SSE>>> │
│                                         │
│  Bridge Key A ──► ch:main ──► [res1]   │
│  Bridge Key B ──► ch:main ──► [res2]   │
│                 ► ch:sports ► [res3]   │
└─────────────────────────────────────────┘
  │  SSE stream per client
  ▼
OBS Browser Source Overlays
```

Events published with Key A **never** reach Key B's connections — full isolation.

---

## Local Development

```bash
cd bridge
cp .env.example .env
# fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm run dev
```

The server starts on `http://localhost:10000`.

Test publish:
```bash
curl -X POST http://localhost:10000/events \
  -H "Content-Type: application/json" \
  -H "x-bridge-key: your-key-here" \
  -d '{"type":"team_sold","channel":"main","code":"KC","buyer":"testuser"}'
```

Test subscribe (in a separate terminal):
```bash
curl -N "http://localhost:10000/stream?channel=main&key=your-key-here"
```
