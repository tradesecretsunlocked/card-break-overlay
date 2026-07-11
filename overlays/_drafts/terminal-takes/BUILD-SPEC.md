# Terminal Takes — Overlay Build Spec (execution-ready)

**Client:** Vann Pitts / TerminalTakes · slug `terminal-takes` · CP-170 / TR-156
**Status:** spec locked 2026-07-10. Build blocked only on workspace VM (needed for a clean clone of the 2,900-line Midwest base + JS validation). Provisioning HELD until paid.

## Base + brand
- **Clone base:** `overlays/midwestbreak/index.html` (multi-sport box-break layout, team + division tiles, ticker, promos, per-tile buyer, sold FX, state persistence — same family as Legends).
- **Brand tokens** (from logo, art-deco): `--bg0/#000` black field, panels midnight navy `#14213D` (deep `#0C1428`), gold `#F3C34A`, chrome-silver `#D8DEE6`. Replace Midwest's `--barnOrange/#FFD700` gold with `#F3C34A`, dark bg with black+navy. Art-deco framing (stepped gold borders/chevrons) to echo the logo.
- **Logo:** `images/logos/terminal-takes-logo.png` in the header lockup.
- **Graphics:** stash-or-pass, see2-pick1, trade2-spin1 (staged at `How to use Claude/graphics/terminal-takes`).

## One overlay, LAYOUT SWITCHER (Mike: both modes in one file, button to toggle)
A top control toggles between two modes; state persists in localStorage.

### Mode A — Multi-Sport Team Board (Jim & Tabby style)
- **Day-of sport selection: exactly 2 sports at a time** (Mike). Selector offers pairs from {NFL, NBA, MLB} (NFL primary). Choosing a pair populates the board with both sports' teams.
- Manual click-to-sell (no box-breaker tool dependency).
- **Buyer assignment (Legends pendingBuyers pattern):** track the last buyer from the sale feed; when the seller clicks the next tile, assign that buyer to it. Show a "NEXT: <buyer>" chip + skip. Buyer name editable inline on the sold row.
- **Combinable spot GROUPS:** seller selects 2+ tiles → "Combine" → they become one group. **Any spot in the group sold marks the ENTIRE group sold, and the buyer name is assigned to every spot in the group** (Mike confirmed: grouped spots behave as ONE spot). Grouped tiles get a shared visual band/badge. Ungroup option.
- Midstream tile edits (add/rename/remove tiles live).

### Mode B — City Sport Division Break
- All selected sports included. Teams are pre-grouped by **city/metro**. Winning/selling any team in a city assigns the buyer to **all that city's teams across sports**, and marks them all sold as one unit.
  - e.g. buyer wins Chicago Bears → also gets Cubs, White Sox, Bulls (+ Blackhawks if NHL later).
- **Automation:** recent-buyer tracking assigns to the individual or combined city spots (same last-buyer→next-click model, but the click/sale cascades to the whole city group).

## Grouping semantics (single source of truth — applies to groups, city, division)
A "group" = a set of tile codes treated as ONE spot:
- `groups: [{ id, memberCodes:[], buyer:'' }]`, persisted in state.
- Selling/clicking any member → mark all members `.sold`, set `group.buyer` = current pending/assigned buyer, render that buyer on every member's sold row (or one combined sold row for the group).
- Left/Sold counts: a fully-sold group counts as **1** sold spot (not N).
- Unsell any member → unsell the whole group.

## Data needed
- Team lists + logo paths for NFL/NBA/MLB already exist in Midwest's `breakTypes`. Reuse.
- **City map:** `CITY_GROUPS = { chicago:['CHI-NFL','CHI-MLB1','CHI-MLB2','CHI-NBA',...], ... }` — build from team metros. (New data table; needs one careful pass.)

## Files to produce
- `overlays/_drafts/terminal-takes/index.html` (this build)
- Extension: clone canonical `extension-UPDATED-04-14-2026`, bake DEFAULTS (bridgeKey generated but NOT inserted to Supabase — provisioning held), sport `nil` (multi-sport infer), overlayId `terminal-takes-overlay`.

## Provisioning — HELD
Do NOT create Supabase bridge_keys/client_services rows until Vann pays (Paid=NO on TR-156). Generate the bridge key UUID and bake it, but leave it inactive/uninserted until go-live.

## Open verification (do on build)
- Confirm Midwest's team `breakTypes` include logo image paths for all 3 sports.
- Decide sold-panel display for groups: one combined row vs per-member rows (default: one combined row labeled with the city/group name + buyer).
