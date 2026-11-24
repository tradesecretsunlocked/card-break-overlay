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
161 spots: 36 chasers plus 125 in the field. Names and tiers follow the official 2026 Update sell sheet and checklist that Mike shared 2026-11-21 (Autographs list, Base Set and Highlighted Heroes list). Athlete pairings come from the same sheet and from thecollectornation.com. Verify against a live break before air. Full list in `heroes.csv` (staged list, 161 rows); `observed-hobby-case.csv` is a reference transcription from a live hobby case break (title style, bundled spots, tiers), not the overlay list.
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
index.html md5 at promotion: 82d32a83bc178fb47bd7e1c9756493d3 (2026-11-21 sold tile and size tweak; previous 670c7445a8227add260ab51e1ef86acc 40 chaser layout; previous e5e0c31ec7f7c888847f5a7f36cbf3c7 readability revision; previous copy d891ff997c1c4518c6c65dfb0d2b2aba, before that md5 ad5d16b8e9bc4b946cc299fe175fba99, kept in `_to_delete/`).


## Readability revision (2026-11-21)
- Display modal uses button groups instead of dropdowns (OBS interact window cannot open native selects): Spot title format, The Field style, Text and card size (Normal / Large default / Extra Large).
- Size scale drives tile names, Field list (now 3 columns x 4 rows), card strip text and card size, metrics, ticker and modals. Large is about 1020 px tall at 1080 wide; Normal matches the old size.
- Tile backgrounds for chaser spots: Display, "Tile background folder or URL". Default `tiles/` expects `tiles/<hero-name-with-dashes>.png` next to index.html (missing files fall back to the gradient). A single image path applies to every tile. A per spot override is the optional 7th Tile column in Spots (heroes.csv has the column). Tiles are darkened for legibility and sold tiles still grey out.

## 40 chaser layout (2026-11-21)
- Chase list is 40: the earlier 36 plus McBladed, Rumblin' Bumblin' Stumblin', Alcatraz and PB Buckets (Superfoil 1/1 power 195 to 200 in the checklist CSV; the same rule puts Superfoil 190+ plus BoJax at 32). Basis: official checklist CSV, hero Superfoil power tracks hero rank. No Mahomes set single sales data found yet.
- Board is 8 columns x 5 rows; Field is 4 columns x 3 rows; strip and header shortened. At Large the overlay ends about 845 px tall (Normal about 706, Extra Large about 931).
- Ticker has its own size control (Ticker modal: Small / Medium / Large / Extra Large).
- Spelling fixed to the official names: McVillain, Carnevore (old spellings still match as aliases).
- An OBS browser source that already saved its Spots list keeps the old 36 chasers: open Spots and press "Restore built in list" once, or New Break.

## Sold tile and size tweak (2026-11-21)
- Sold tiles: the hero name is dimmed and struck through but the buyer name is full white, no longer shaded. Done with a dim layer behind the text instead of a filter on the whole tile.
- Card strip cards about 12 percent larger; Field (scrolling names) font 13 to 15 base. Overlay ends about 859 px tall at Large.
