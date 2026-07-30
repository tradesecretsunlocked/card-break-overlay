> ⛔ **SUPERSEDED 2026-07-30.** Replaced by `card-break-overlay/docs/SOP-CLIENT-PROVISIONING.md`. Archived during the documentation consolidation audit. Kept for history only. Do not use this file for current work.

# TSU Platform — Full Client Workflow

This document maps every step from purchase to go-live, including who owns each step,
what system handles it, and where gaps or manual steps currently exist.

---

## Stage 1 — Purchase

**Trigger:** Customer purchases on stan.store

**What happens:**
- stan.store fires Zapier trigger
- Zapier creates Notion client profile
- Welcome email sent to customer automatically

**Current gap:** stan.store Zapier trigger only fires for NEW customers.
Returning customers who purchase an additional overlay do not trigger the automation.
Workaround in progress: direct Stripe webhook integration (stan.store uses Stripe under
the hood — separate project in progress).

**Status: Partially automated**

---

## Stage 2 — Questionnaire

**Trigger:** Customer receives welcome email with questionnaire link

**What happens:**
- Customer completes questionnaire (branding, sport, colors, preferences)
- Questionnaire response updates their Notion profile
- Confirmation email sent to customer:
  *"Your order is now in the build queue. We'll be in touch soon."*
- Order entry created in Notion Build Queue with status: `Pending`

**Status: Partially automated** — questionnaire → Notion update needs to be verified

---

## Stage 3 — Overlay Build

**Trigger:** Order appears in Notion Build Queue with status `Pending`

**What happens:**
- TSU Overlay Agent (Claude / Cowork) reads the build queue entry
- Selects source overlay based on layout family and feature requirements
- Clones source → applies branding edits → stages to `overlays/_drafts/{client-slug}/`
- Updates Notion: Queue Status → `ready_for_review`
- Build summary written to Notion Build Notes

**Mike's role:** Review the draft overlay in browser, verify branding and functionality

**Status: Automated** (TSU Overlay Agent skill)

---

## Stage 4 — Internal Review & Approval

**Trigger:** Overlay Agent sets Queue Status to `ready_for_review`

**What happens:**
- Mike opens `_drafts/{client-slug}/index.html` and reviews
- Verifies: colors, logo, title, sport layout, automation behavior
- If approved: promotes draft to `overlays/{client-slug}/index.html`
- Trigger email sent to client automatically:
  *"Your overlay is built and going through internal review and testing.
   We've created a project folder in Google Drive — your prep instructions
   are already there. Make sure OBS is downloaded and ready before your
   deployment appointment."*
- Google Drive project folder created for client (or already exists from Stage 1)
- Prep Instructions Packet uploaded to Drive
- Client Notion status updated: `Prepare to Deploy`

**Mike's role:** Review and approve the draft

**Current gap:** Email trigger after approval and Google Drive folder creation
are currently manual steps. These can be automated via Zapier (Notion status
change → send email + create Drive folder).

**Status: Manual — automation planned**

---

## Stage 5 — Deployment Prep

**Trigger:** Client status set to `Prepare to Deploy`

**Who:** Mike or a team member (deployer)

**What happens:**
- Deployer updates client status: `Preparing to Deploy`
- Deployer builds the OBS deployment package:
  - Opens OBS
  - Imports overlay as browser source (uses client's hosted overlay URL or HTML file)
  - Configures scene layout (graphics, camera, alerts, etc.)
  - Exports **Scene Collection** file (`.json`)
  - Exports **Profile** file (`.ini` folder)
- Deployer builds the client's Chrome extension:
  - Opens `extension-UPDATED-04-14-2026/content.js`
  - Sets `DEFAULTS.bridgeKey` to client's bridge key
  - Zips the extension folder → `{client-slug}-extension.zip`
- All files uploaded to client's Google Drive folder:
  - Scene Collection `.json`
  - Profile folder
  - `{client-slug}-extension.zip`
  - Any additional supporting documents
- Appointment scheduled with client

**Status: Manual**

---

## Stage 6 — Deployment Appointment

**Trigger:** Appointment scheduled

**Who:** Mike or team member (deployer) + client

**What happens:**
- Appointment reminder sent to client (automated via calendar tool)
- During appointment, deployer:
  - Walks client through downloading their files from Google Drive
  - Walks client through importing OBS Scene Collection and Profile
  - Walks client through installing the Chrome extension
  - Confirms overlay is visible in OBS and connects to the bridge
  - Confirms extension is installed and firing events correctly
  - Covers go-live checklist
  - Points client to: Troubleshooting Guide, Support documentation

**Status: Manual**

---

## Stage 7 — Go Live

**Trigger:** Deployment appointment complete

**What happens:**
- Client Notion status updated: `Active`
- Client goes live on their next stream
- Ongoing: bridge logs events to Supabase (`bridge_events` table)
- Ongoing: client can reach out for support

**Status: Manual status update — monitoring automated via Supabase**

---

## Automation Opportunities (Future)

| Step | Current | Future |
|---|---|---|
| Purchase trigger (returning customers) | Gap — stan.store only fires for new customers | Direct Stripe webhook integration |
| Google Drive folder creation | Manual | Zapier: Notion status change → create Drive folder |
| Approval email to client | Manual | Zapier: Notion status → `ready_for_review` → send email |
| Extension zip generation | Manual | Script: generate per-client zip from template |
| Appointment scheduling | Manual | Calendly or similar integration |
| Appointment reminder | Manual | Calendly automated reminders |
| Status updates | Manual | Zapier: calendar event → update Notion status |

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PURCHASE LAYER                           │
│   stan.store ──► Zapier ──► Notion (client profile + queue)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BUILD LAYER                             │
│   Notion Build Queue ──► TSU Overlay Agent (Claude/Cowork)     │
│   Source: overlays/{source-slug}/index.html                    │
│   Output: overlays/_drafts/{client-slug}/index.html            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DEPLOYMENT LAYER                           │
│   Google Drive (client folder)                                  │
│   ├── OBS Scene Collection (.json)                             │
│   ├── OBS Profile (.ini)                                       │
│   ├── Chrome Extension (.zip)                                  │
│   └── Supporting docs                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       LIVE LAYER                                │
│                                                                 │
│   OBS Browser Source                                           │
│   └── overlays/{client-slug}/index.html                        │
│       └── connects via SSE to:                                 │
│           bridge.tradesecretsunlocked.com                      │
│           (authenticated by client bridge key)                 │
│                                                                 │
│   Chrome Extension (on Whatnot tab)                            │
│   └── detects sales ──► POSTs to bridge ──► overlay updates   │
│                                                                 │
│   Supabase                                                     │
│   ├── bridge_keys (access control — key → active/revoked)     │
│   └── bridge_events (event log — every sale recorded)         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Reference Paths

| Resource | Path |
|---|---|
| Overlay source files | `overlays/{client-slug}/index.html` |
| Draft overlays (pre-approval) | `overlays/_drafts/{client-slug}/index.html` |
| Extension template | `extension-UPDATED-04-14-2026/` |
| Bridge server | `bridge/server.js` → `bridge.tradesecretsunlocked.com` |
| Client onboarding steps | `bridge/CLIENT-ONBOARDING.md` |
| Migration key reference | `bridge/migration-keys.sql` |
| Notion Build Queue | DB: `32d7e2ad-ff2f-809a-b2ea-c090c751cbb7` |
| Supabase tables | `bridge_keys`, `bridge_events` |
