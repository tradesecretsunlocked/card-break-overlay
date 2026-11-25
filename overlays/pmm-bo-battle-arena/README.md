# PMM x TSU: Bo Jackson Battle Arena Character Break (draft)

Staged 2026-11-21 for Mike's own break: 2026 Bo Jackson Battle Arena Update Edition (The Mahomes Set, Merlomes cover), Double-Mega box plus Blaster box, run as a character break. Status: PROMOTED 2026-11-21 to `overlays/pmm-bo-battle-arena/` at Mike's request, awaiting Mike's push to main. The `_drafts/` copy is kept for rollback. Not a `builds` row (Mike's own overlay, same as pmm-box-break).

## Why a new overlay and not a layout inside pmm-box-break
pmm-box-break is a 173KB team-code board (32 NFL teams plus a sport switcher). A character break is a name-matched board with 161 custom spots, a different engine. Plumbing (bridge, storage, modals, export, sold flow) is cloned from `overlays/wizards-wonders` (the lean title-matched reference). Brand is PMM (teal and purple, pmm-logo.png). pmm-box-break is untouched.

## URLs (after Mike pushes to main)
| View | URL |
|---|---|
| Main board | https://tradesecretsunlocked.github.io/card-break-overlay/overlays/pmm-bo-battle-arena/index.html |
| Facecam list, infinite upward scroll | same URL plus `?view=list` |

Same file, same bridge key, same saved state. The list view never writes storage, it only follows the main view and the live sales feed.

List view options (all optional): `speed` (pixels per second, default 40), `size` (font px, default 26), `width`, `height` (px), `show` (all, chasers or field), `buyers=1` (show buyer names on sold lines). Sold spots get a red line through them and dim.

## Identity (matches the installed PokeMasterMates extension, no reinstall)
| Field | Value |
|---|---|
| Bridge key | 0798c26d-3d29-4d6e-876c-ed676ff20a3d |
| Whatnot handle | pokemastermates |
| OVERLAY_ID | pmm-test-overlay |
| LS namespace | pmmboba. |
| Extension | extension-unified/_builds/pokemastermates-v3.4.2 (sendUnresolved true, required for name matched boards) |

## Spot title format (the one rule that matters)
Live Merlomes hero breaks title spots with the hero label itself, for example `★ BOJAX 🔥 👻 - BO JACKSON`, `MAVERICK (HIGHLIGHTED) - INSPIRED BY COOPER FLAGG` or `Donny Buckets - Inspired by Luka Doncic` (seen in Mike's screenshots of a live hobby case break, 2026-11-21). The matcher handles that:
| Title | Rule |
|---|---|
| No spot number | The whole title is matched against hero names. Stars, emoji, case and punctuation are ignored. Only hero names are indexed, never the athlete, so a title that is only an athlete name marks nothing. |
| `<break> #<n> - <Hero>` | Only the text AFTER the number is matched, so a break name containing Merlomes or Bo Jackson cannot mark a spot. A placeholder with no hero yet marks nothing. |
| Spot lists two or more heroes | Every hero in the title is marked sold. Mike's ruling 2026-11-21: a buyer who lands a multi-character spot gets every character in it, and a buyer who wins a character gets all its variants, so one hero is one spot. |
Spelling variants are aliased (NatureBoy, xPressDelivery, JuliusSeizer, Turbo GT, Quinpin, McVillain, Carnevore). Display has a switch to match a hero name anywhere in the title even when a number is present.
Sale handling follows the Standard: dedup and respin key on saleId. A saleId can hold several spots; a respin releases the old spots that are not in the new set and plays the new spots' animations, an unsold releases the whole set. A buyer may hold any number of spots. `overlayIdMatches` and `breakIdMatches` guard every event.

## The list
161 spots: 40 chasers plus 121 in the field. Names and tiers follow the official 2026 Update sell sheet and checklist that Mike shared 2026-11-21 (Autographs list, Base Set and Highlighted Heroes list). Athlete pairings come from the same sheet and from thecollectornation.com. Verify against a live break before air. Full list in `heroes.csv` (staged list, 161 rows); `observed-hobby-case.csv` is a reference transcription from a live hobby case break (title style, bundled spots, tiers), not the overlay list.
Tiers: signer (autograph list, 80 heroes), Highlighted (10: Alcatraz, Generator, Gladiator, Ionic, Larry The Builder, Maverick, McVillian, PB Buckets, A to Z, McBladed), base hero (the rest). Tile and card faces show a star for signers and HL for Highlighted.
Chasers are every hero on Mike's two chase lists, 36 after overlap: the 23 top Graviton heroes plus the 20 on the Queen of Breaks board, overlaps first. Mike's instruction: use the Double-Mega and Blaster exclusives, not the Hobby exclusives. Per the official sheet, Graviton, Gum, the color foils, Full-Art Alt Art, Miami Ice, Fire Tracks and Mixtape are Hobby and Jumbo only, so no Power number and no fire or ghost flag is shown anywhere. Double-Mega and Blaster carry Great Grandma's Linoleum, Grillin', Chillin', Slime and the Icon Battlefoils (Brawl, Steel, Ice, Fire, Glow, Hex); Double-Mega only has Bonus Plays and Power Glove; Blaster only has the Headlines (Silver, Blue, Orange, Red). Exclusivity is by card treatment, not by hero, so the chaser list itself is the same for every box type. Edit it live from the Spots button (a Y in the Chaser column), or load a CSV with an optional sixth column Tier (F, H or P).

## What the board shows
| Piece | Behaviour |
|---|---|
| Metrics | Sold, Spots Left, Chasers Left (of 36), Chasers Sold, Non-Chasers Sold (of 125), Chaser Odds |
| Chaser Odds | Chasers left divided by spots left. Toggle in Display. |
| The Chasers | Tiles with hero, athlete and a tier mark (star signer, HL highlighted). Sold: grey, line through, buyer name. |
| The Field | 12 non-chasers per page, fades between pages (default 7 seconds). Display switches it to a slow scroll. Sold: line through. A small toast confirms each field sale. |
| Chaser card strip | Scrolling cards of the chasers. Image per chaser from `cards/<hero-name>.png`, generated card face when missing. Toggle in Display. |
| Chaser sale | The card leaves the strip, spins to the middle of the screen with rays, a flash, rings and sparks, a SOLD stamp slams on, the buyer banner rises, it holds, then flies back to its strip slot smaller and greyed with the buyer name across it. Toggle in Display. |
| Admin | Click Sold to show or hide the pills. Spots, Display, Title, Ticker, Export, New Break, Reset. Click any tile to mark or unmark by hand. |

## Card images
Not included. Drop PNGs (about 3:4 portrait) into `cards/` using the filenames in `cards/CARD-FILENAMES.txt`, or put a path or web address in the Image column of the Spots screen. Until then the generated faces show, and nothing breaks.

## Tested
Logic tested in a DOM harness (all pass): the real live-break title shapes, bundled spots marking every hero, bundle respin and unsold, replay idempotence, #n guard and placeholder titles, spelling variants, athlete-only titles marking nothing, saleMap persistence across reload. Rendered in headless Chrome at 1080 wide: 36-tile chaser board, bundle sales, strip, animation, list view. NOT tested against the live bridge or a real Whatnot show. Run one test listing before air.

## Review and promote
Promoted 2026-11-21: this folder (without `_to_delete/`) copied to `overlays/pmm-bo-battle-arena/`. No new Supabase rows: it reuses Mike's installed PMM identity (key above, already active in `bridge_keys`), and there is no `builds` row. Mike pushes main, then refresh the OBS browser-source cache.
index.html md5 at promotion: d891ff997c1c4518c6c65dfb0d2b2aba (previous staged copy, md5 ad5d16b8e9bc4b946cc299fe175fba99, kept in `_to_delete/`).

## Sold panel and non-chaser animation (2026-11-24)
- Sold panel is 4 columns inside the 1080 px overlay (no horizontal scroll). Each entry stacks the small hero name over a full-width buyer input at 24 px (18 pt). The panel box now uses border-box, which removed the old 22 px overflow past the overlay edge. Verified in Chrome at 1080 wide: panel 0 to 1080, document scroll width 1080, 4 per row, inputs 24 px.
- Non-chaser (Field) sales now play a short pop: a red ring and glow, a quick scale, and a red strike drawn through the name, on the Field box and the ?view=list page, plus the SOLD toast. Chasers keep the full card animation.

## Whatnot box break widget spot lists (2026-11-24)
Folder `whatnot/`: `1-chasers-40.csv`, `2-field-A-61.csv`, `3-field-B-60.csv` (and `ALL-161-reference.csv`, not for pasting). Columns: Spot Name, Price (blank, you set it), Description. Whatnot's help center says a custom spot list pastes into the Break builder spreadsheet from Sheets or Excel (spot name, price, description) with a cap of 75 custom spots per break, so 161 spots is split across three breaks. Spot names are `HERO - Athlete` (chasers) and `Hero - Inspired by Athlete` (field). All 161 names were run through the overlay matcher: each marks exactly one hero. Do not rename spots after pasting.

Exact-name option (2026-11-24): `whatnot/ALL-161-exact-OBS-names.csv` uses the hero name exactly as the overlay spells it (for example `BoJax`) as the spot name, with the athlete and tier in the description. Cap check: Mike confirmed 2026-11-24 the Whatnot custom spot list now takes 250, so one paste of all 161 works and the three split files are optional. Verified: all 161 exact names mark exactly one hero. The `HERO - Athlete` files match functionally (the overlay finds the hero inside the title) but the strings are not identical to OBS.

## Card images (2026-11-24)
`cards/CARD-FILENAMES.txt` lists what is present and what is missing (24 of 40 chasers have a card, 16 missing). Newest file per name wins between `_drafts` and `overlays`. Stray files named `daly-drive.png` and `he-glide.png` match no hero and are unused.
