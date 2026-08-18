# TSU Bridge Event Contract

**Status:** CANON for every platform integration. v2, written 2026-08-18.
**Applies to:** the Whatnot extension, the Loupe extension, the TikTok bridge, and every future emitter.
**Validator:** `card-break-overlay/shared/eventContract.js`. Import it, do not reimplement it.

---

## Why this document exists

An audit of 305,511 production `team_sold` rows found **five different payload key-sets for one event type**.

| Rows | Clients | Still emitting | Missing |
|---|---|---|---|
| 216,735 | 24 | yes | nothing |
| **87,499** | **1** | **yes** | **`teamCode`, `buyerName`** |
| 980 | 1 | to Aug 8 | `amountCents`, `currency` |
| 296 | 1 | to Jun 12 | `channel`, `ts`, `type`, `listingId` |
| 1 | 1 | Jul 2 | had a stray `spot` key |

One client emitted without `teamCode` and `buyerName` for months, 28 percent of all sales, and nothing flagged it. It stayed harmless only because the overlay reads `code` and never `teamCode`. The first feature written against `teamCode` would have broken for that one client, silently, mid-break.

**Redundancy without validation is not safety. It is a second thing to drift.**

---

## The prime directive

**Never remove or rename a field.** Overlay files are baked per client and hosted. You cannot update the fleet. Every change is additive, forever, until a re-bake of every overlay happens for some other reason.

---

## The sale event

`team_sold` and `team_unsold` share one shape.

### Canonical fields, read these

| Field | Type | Notes |
|---|---|---|
| `saleId` | string | Platform-prefixed. **Not unique on its own.** See identity grain. |
| `code` | string | The board joins tiles on this. `MIN`, `CUSTOM_022`. Vocabulary is open, not closed. |
| `buyer` | string | Display handle |
| `amountCents` | integer | **Canonical money.** Integers because floats drift. |
| `currency` | string | ISO code |
| `title` | string | Human label for the sold flash |
| `sport` | string | `nfl`, `mlb`, `nil` |
| `channel` | string | `main` for sales, `sports` for scores. Nothing else, ever. |
| `type` | string | `team_sold` or `team_unsold` |
| `overlay_id` | string | Which overlay this belongs to |
| `ts` | number | Millisecond epoch |
| `liveId` | string | Session id. **Platform-specific, see below.** |
| `productId`, `listingId` | string | Platform identifiers |

### v2 additions

| Field | Type | Why |
|---|---|---|
| `v` | integer | Contract version. Without it you cannot measure who is still on an old shape, so you can never safely deprecate anything. |
| `platform` | string | `whatnot`, `loupe`, `tiktok`. Required because `liveId` is ambiguous without it. |

Both are **warnings, not errors**, in the validator. v1 emitters are still in the field and must keep working.

### Legacy mirrors, emitted but never read

| Mirror | Mirrors | 
|---|---|
| `id` | `saleId` |
| `teamCode` | `code` |
| `buyerName` | `buyer` |
| `amount` | `amountCents / 100` |

Keep emitting them. Never read them in new code. The validator errors if a mirror disagrees with its canonical field.

---

## Identity grain: `(saleId, code)`, not `saleId`

**This is the most important rule in the document and it was undocumented until now.**

Production evidence, 2026-08-18: of 128,887 distinct saleIds, **93,487 carry more than one event** and **78,142 span more than one code**. Worst case observed: one saleId across **31 codes and 146 events**.

That is correct behaviour. One buyer checking out once legitimately takes 31 tiles off the board, and the board needs one event per tile.

**Deduping on `saleId` alone silently swallows every tile after the first on a big multi-team sale.** Use `saleKey(payload)` from the validator module.

This bug was shipped in the TikTok bridge and caught only by auditing production before answering an architecture question.

---

## Platform prefixes

`saleId` carries a prefix so ids cannot collide inside the overlay's dedupe set. This matters for the minority of clients provisioned on more than one platform.

| Platform | Prefix |
|---|---|
| Whatnot | `wn:` |
| Loupe | `lp:` |
| TikTok | `tt:` |

---

## `liveId` means different things per platform

| Platform | What `liveId` holds |
|---|---|
| Whatnot | Whatnot live UUID |
| Loupe | Loupe session identifier |
| TikTok | `line_items[].room_id`, falling back to `auto_combine_group_id` |

This is exactly why `platform` had to be added in v2. A consumer holding only the payload could not tell what it was looking at.

---

## Adding a platform

1. Import `validateSaleEvent` from the shared module. Do not hand-roll a mapper.
2. Build canonical fields, then call `withMirrors(payload, platform)`.
3. Assert in tests that the emitted key set matches a real production row.
4. Reuse `teamCodes.js` verbatim. Copy it, never rewrite it. A resolver that differs even slightly lights different tiles for the same break depending on platform.
5. Pick a `saleId` prefix and add it to `SALE_ID_PREFIX`.
6. Emit one event per sold unit. Never multiply by a quantity field.

---

## Known weaknesses, deliberately not fixed yet

| # | Weakness | Why it waits |
|---|---|---|
| 1 | Four redundant alias pairs | Removing them is breaking. Wait for a fleet re-bake. |
| 2 | `type` duplicates the `event_type` column | Same reason. Two sources of truth for one fact. |
| 3 | No quantity field | Fine while every platform gives one line item per unit. Revisit if one gives quantity only. |
| 4 | `sport` copied onto all 305k sale events | Session-scoped fact stored per row. See below. |
| 5 | `overlay_warmup` uses `overlay_id`, `overlayId` AND `overlay` | Three spellings for one field in live data. The TikTok bridge accepts all three. Fix by validation, not by renaming. |

---

## The next thing to design: the session envelope

Not the sale event. **The session.**

`sport`, `overlay_id`, `breakId`, `liveId` and `platform` are session-scoped facts being copied onto every sale event. `sport` changes a few times a day and is stored 305,511 times.

A `session_started` event carrying those facts once, with sale events referencing a `sessionId`, would:

- kill the `overlay_warmup` key-spelling mess by giving it one authoritative shape
- make "orders from this break" a lookup instead of a client-side grouping
- give TikTok's `live_id` (from Get Shop LIVE Performance List) a natural home
- shrink the sale event

**That is where the next platform will hurt, not in `team_sold`.** Design it before the next integration, not during.

---

## Rollout, in order

1. **Land the validator, change no schema.** Wire `validateSaleEvent` into the extension build and both bridges. This alone would have caught the 87k fork on day one. Cheapest, highest value.
2. **Emit `v: 2` and `platform`.** Purely additive.
3. **Document the mirrors as legacy.** Nothing in new code reads them.
4. **Design the session envelope.**
5. **Drop the mirrors only during a fleet re-bake.** Not before.

---

## Related

- `card-break-overlay/shared/eventContract.js`, the validator
- `card-break-overlay/TSU-OVERLAY-STANDARD.md`, build mechanics
- `card-break-overlay/tiktok-bridge/src/normalize.js`, a worked example of mapping a platform onto this contract
- `TSU-TIKTOK-INTEGRATION.md`, TikTok canon
