# Archived 2026-07-30: docs retired in the consolidation audit

These files belong to the `card-break-overlay` repository and were retired
during the 2026-07-30 documentation consolidation audit. They are kept inside
the repo so its git history stays coherent. Nothing here is current.

## Where to go instead

| Need | Read this |
|---|---|
| How to build an overlay, extension, or key | `TSU-OVERLAY-STANDARD.md` at the repo root |
| Provisioning a client, purchase to deployed | `docs/SOP-CLIENT-PROVISIONING.md` |
| Repo orientation and agent rules | `CLAUDE.md` at the repo root |

## What is in here and why it was retired

### `STANDARDS.md`

The old repo standards file. Superseded by `TSU-OVERLAY-STANDARD.md`. It was
actively harmful because it put bridge configuration into the localStorage key
map:

```js
const LS = { ..., BRIDGE: `${CLIENT}.bridgeUrl`, KEY: `${CLIENT}.bridgeKey` };
```

`TSU-OVERLAY-STANDARD.md` v2.3 explicitly bans reading bridge config from
localStorage. Bridge base and key are hardcoded constants with a URL parameter
override, nothing else. Per-client board state in localStorage is still correct
and still required, so the ban is narrower than it first appears: it is about
bridge config only.

### `WORKFLOW.md`

The purchase-to-go-live map. Its structure was sound but every stage was keyed
to Notion: Notion client profiles, a Notion build queue, and Notion status
values such as `Pending`, `ready_for_review`, `Prepare to Deploy` and `Active`
that do not exist in the live `builds.status` enum. The deployment detail in
its stages 5 and 6, the OBS scene collection and profile export, the per-client
extension zip, the Google Drive handoff and the appointment walkthrough, was
harvested into `docs/SOP-CLIENT-PROVISIONING.md` before archiving.

### `MANUAL-UPDATES-NEEDED.md`

A to-do list of documentation edits to apply by hand. It matters historically
because it is the origin of two errors that then propagated into the Cowork
global instructions: it instructed reading the build queue from Notion and
never skipping the Notion write-back, and it mandated `--primary` and
`--secondary` CSS variables that no live overlay actually uses. Both were
corrected in the audit. The correct extension `DEFAULTS` block it described
now lives in `TSU-OVERLAY-STANDARD.md`.
