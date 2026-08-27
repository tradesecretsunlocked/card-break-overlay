# TSU Style Library

Universal style anchors, organized by graphic type. This is the live source the
`tsu-graphic-generator` skill reads (`STYLE_LIBRARY`, default `{GRAPHICS_ROOT}/_style-library`).

Seeded 2026-08-27 from Mike's curated favourites plus the skill's bundled examples for the
types he had not supplied.

## How these are used

For a NEW client with no approved graphic of their own, the generator pulls the example of the
SAME type from here and **desaturates it** (`scripts/prep_anchor.py`) before passing it to the
API. Grayscale carries the TSU texture, lettering and composition without dragging the source
client's colours into the new brand — the prompt plus the new client's own full-colour logo
supply the palette.

Once a client has an APPROVED graphic of their own, use that instead, full colour, staged as
`style-anchor.png`.

## Contents

| Type | File | Source |
|---|---|---|
| stash-or-pass | stash-or-pass--southside-collects.png | southside_collects |
| see2-pick1 | see2-pick1--coachs111.png | Coachs111 Sports |
| see2-pick1 | see2-pick1--heat-check.png | Heat Check Cards |
| see2-pick1 | see2-pick1--how-you-doin.png | How You Doin? Collectors |
| pyt | pyt--chaotic-card-crew.png | Chaotic Card Crew |
| big-hit | big-hit-bang--coachs111.png | Coachs111 Sports |
| see3-pick2 | see3-pick2--neon.png | neon pink/cyan reference |
| see3-pick2 | see3-pick2--samoxin.png | Samoxin's Collectables Vault |
| clear-the-board | clear-the-board--bundled.png | skill bundled example |
| promo | promo--bundled.png | skill bundled example |
| background | background-scene--bundled.png | skill bundled example |

## Adding to it

Drop an approved graphic into the folder for its type and name it
`{type}--{client-slug}.png`. Prefer real approved client work over the bundled examples: the
bundled set is a fallback, this library is the product.
