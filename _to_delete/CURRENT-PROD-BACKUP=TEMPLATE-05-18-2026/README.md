# CURRENT-PROD-BACKUP=TEMPLATE-05-18-2026: frozen snapshot, do not follow

> ARCHIVE. This folder is a point-in-time copy taken 2026-05-18. Its documents are kept only
> to show what production looked like on that date. **Do not follow any instruction in here.**

What is stale inside it:

- `bridge/CLIENT-ONBOARDING.md` tells you to build from the Notion queue. The queue is the
  Supabase `builds` table and Notion is retired as an operational source of record.
- `bridge/README.md` documents a `?bridge=` migration path and per-client
  `tsu-bridge-<client>.onrender.com` services. There is one shared bridge,
  `https://bridge.tradesecretsunlocked.com`, and the per-client bridge key is baked into the
  overlay file and the extension.

The live canon is `../TSU-OVERLAY-STANDARD.md` for build mechanics,
`../docs/SOP-CLIENT-PROVISIONING.md` for provisioning and deployment, and `TSU-MEMORY.md` at
the GitHub root for platform state.
