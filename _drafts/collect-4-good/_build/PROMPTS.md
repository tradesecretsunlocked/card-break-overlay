# Collect 4 Good — Graphic Prompts

**Client:** Collect 4 Good (Cory Donahue)
**Brand palette:** #4FB6E0 primary cyan · #7BD1F0 bright cyan · #1A6E9B deep cyan · #000000 base · #FFFFFF text
**Sport:** WNBA only (women's basketball)
**Logo:** wordmark-style — no mascot. Circular dashed cyan ring + white "COLLECT" and "4 GOOD" text.
**Mission tone:** modern, hopeful, minimalist, high-contrast, professional women's-sports feel.

Eyeball each prompt below and tweak `manifest.json` in place before running. To re-roll one after the batch, run `python generate_graphics.py --only NAME --force`.

---

## 1. `promo` — rotating promo banner (opaque, 1536x1024)

> A wide full-bleed opaque promotional banner backdrop for a WNBA sports-card break livestream, in a modern minimalist broadcast style. No mascot character; carry the Collect 4 Good brand's circular cyan-ring badge finish with clean white sans-serif lettering. Feature dynamic basketball court energy at the outer edges — subtle diagonal streaks, a suggestion of hardwood shine, glowing dashed cyan segments echoing the logo's ring. Primary color bright cyan #4FB6E0, secondary pure white #FFFFFF, deep cyan gradient depth #1A6E9B, on a pure black #000000 base. Keep a clean low-contrast central band left calm and open for scrolling text (no baked-in copy). High-contrast rim lighting, glossy cyan highlights, subtle cream-white accents. Integrate the Collect 4 Good identity naturally using the provided logo as a high-fidelity reference; if a small studio wordmark is rendered anywhere, spell it EXACTLY as in the logo. Full-bleed opaque background, no rectangular frame. Crisp, high-resolution, premium broadcast feel, punchy, readable from a distance. NOT flat, NOT hand-sketched, NOT warm orange or gold.

**Model:** `gpt-image-2` (opaque scene, cheaper for landscape)
**Anchors:** `_build/anchors/promo-anchor.png` (grayscale) + `collect-4-good-logo.png`
**Why priority 1:** Currently the HTML falls back to an empty banner because the bird-dogz `promo.png` is polluting the CFG folder.

---

## 2. `overlay-bg` — full-overlay background (opaque, 1536x1024)

> A full-bleed opaque studio-scene backdrop for a WNBA sports-card break livestream overlay. Rich pure-black #000000 base with a subtle radial cyan glow (bright cyan #4FB6E0 and glow-highlight cyan #7BD1F0) blooming softly from the upper-center and edges, plus a deeper cyan-navy #1A6E9B depth gradient at the bottom. Suggest atmospheric basketball court elements far off in the background — a faint hardwood grain hint, softly out-of-focus arena lights, a barely-there hoop silhouette — but keep the center calm and mostly empty so overlay tiles, camera and text sit cleanly on top. Integrate the Collect 4 Good identity subtly: the logo's circular dashed cyan ring motif can appear as a soft watermark at very low opacity, positioned off-center. NO warm oranges or golds, NO neon magenta. Cinematic dark broadcast look — minimalist, hopeful, women's-sports professional. Full-bleed opaque background, calm central region, edges energetic. Crisp high-resolution, premium.

**Model:** `gpt-image-2`
**Anchors:** `_build/anchors/background-anchor.png` (grayscale) + `collect-4-good-logo.png`
**Why priority 2:** Currently the HTML uses a pure black-cyan gradient fallback; the bird-dogz `overlay-bg.png` is polluting the CFG folder.

---

## 3. `stash-or-pass` — game badge (transparent, 1024x1024)

> A transparent die-cut emblem badge for a WNBA women's basketball card break livestream, in a bold 3D sports/esports broadcast style. It reads "STASH or PASS" in large bold beveled metallic letters, with "or" small between the two big words. No mascot character; carry the Collect 4 Good brand's finish — clean white sans-serif wordmark and a segmented cyan circular ring badge — as the emblem's structural motif. Feature dynamic women's basketball action energy: a WNBA basketball mid-flight with a whoosh trail on one side, a stylized trading-card fan on the other, one card highlighted as the 'stash' pick and one being tossed as the 'pass'. Primary color bright cyan #4FB6E0, secondary pure white #FFFFFF, deep cyan #1A6E9B for gradient depth, with cool chrome-white highlights and hard black outlines against a transparent background. Glossy 3D lettering with dramatic depth and rim lighting, layered composition, explosive cyan-and-white paint-splatter shards, premium merch-quality die-cut edge. A small 'COLLECT 4 GOOD' lockup may sit above the main wording, spelled EXACTLY as in the provided logo. Transparent background, die-cut emblem only, clean alpha edge, no rectangular backdrop. NOT flat, NOT hand-sketched, NOT warm orange or gold or magenta. Crisp, high-resolution, premium and punchy, readable from a distance.

**Model:** `gpt-image-1.5` (needed for transparent badges)
**Anchors:** `_build/anchors/stash-or-pass-anchor.png` (grayscale) + `collect-4-good-logo.png`

---

## 4. `see2-pick1` — See 2 Pick 1 badge (transparent, 1024x1024)

> A transparent die-cut emblem badge for a WNBA women's basketball card break livestream, in a bold 3D sports/esports broadcast style. It reads "SEE 2 PICK 1" with the numerals huge and the words tighter, in bold beveled metallic letters. No mascot character; carry the Collect 4 Good brand's finish — clean white sans-serif wordmark and segmented cyan circular ring motif — as the emblem's structural cue. Composition: two trading cards face-up side by side, one glowing bright cyan as the chosen pick, a spotlight beam highlighting it, a WNBA basketball motif tucked into the design. A pointing/choosing gesture, dynamic energy. Primary color bright cyan #4FB6E0, secondary pure white #FFFFFF, deep cyan #1A6E9B for gradient depth, with chrome-white highlights and hard black outlines. Glossy 3D lettering, dramatic rim lighting, layered composition, explosive cyan sparks and starburst behind the chosen card, premium merch-quality die-cut edge. Small 'COLLECT 4 GOOD' lockup may sit above the numerals, spelled EXACTLY as in the provided logo. Transparent background, die-cut emblem only, clean alpha edge, no rectangular backdrop. NOT flat, NOT hand-sketched, NOT warm orange or gold or magenta. Crisp, high-resolution, premium and punchy, readable from a distance.

**Model:** `gpt-image-1.5`
**Anchors:** `_build/anchors/see2-pick1-anchor.png` (grayscale) + `collect-4-good-logo.png`

---

## 5. `big-hit` — Big Hit / BUCKET! celebration (transparent, 1024x1024)

> A transparent die-cut 3D comic-explosion emblem for a WNBA women's basketball card break livestream. Massive glossy beveled letters read "BIG HIT" as the hero word (or "BUCKET!" if it composes better) with a smaller "COLLECT 4 GOOD" ribbon or lockup tucked below or above, spelled EXACTLY as in the provided logo. No mascot character; use the Collect 4 Good brand's cyan ring finish and clean white wordmark styling. Comic-book starburst / impact explosion background with flying debris, angular impact shards, motion streaks and a burst of cyan and white energy radiating out. A WNBA basketball element (or two) can appear mid-explosion. Primary color bright cyan #4FB6E0, glow-highlight cyan #7BD1F0, secondary pure white #FFFFFF, with chrome-white blast highlights and hard black outlines. High gloss, dramatic rim lighting, dramatic depth, premium merch-quality die-cut edge. Transparent background, die-cut emblem only, clean alpha edge, no rectangular backdrop. NOT flat, NOT hand-sketched, NOT warm orange or gold or magenta. Crisp, high-resolution, premium and punchy, readable from a distance.

**Model:** `gpt-image-1.5`
**Anchors:** `_build/anchors/big-hit-anchor.png` (grayscale — from `hes-on-fire.png`) + `collect-4-good-logo.png`
**Note:** No `big-hit.png` exists in the style-examples library. Used `hes-on-fire` as the closest explosion/burst analog. If the vibe drifts toward "flames" too much, re-roll after swapping the anchor to `pyt-wordmark` (calmer emblem base).

---

## 6. `chase-tile-treatment` — chase-spot tile background (transparent, 1024x1024)

> A transparent square emblem-style tile background designed to sit UNDER a small team-logo tile on a broadcast overlay board, marking that tile as a 'chaser' spot. Composition: a bold cyan ring border matching the Collect 4 Good logo's segmented circular dash motif, with the word "CHASER" rendered as a small tag ribbon across the top or bottom of the tile in bold white sans-serif letters (spelled exactly). A subtle stylized WNBA basketball silhouette or hoop icon can sit centered as a low-opacity watermark, so a team logo layered on top remains the visual focus. Primary color bright cyan #4FB6E0, glow-highlight cyan #7BD1F0, secondary pure white #FFFFFF, with a soft glowing cyan pulse effect radiating from the outer edge to make the tile 'stand out' on the board. Deep cyan #1A6E9B corner shading for depth. Transparent background, die-cut edge, no rectangular backdrop, center is calm/light so team logos are still readable when layered on top. NOT flat, NOT hand-sketched, NOT warm orange or gold or magenta. Crisp high-resolution, premium.

**Model:** `gpt-image-1.5`
**Anchors:** `_build/anchors/pyt-anchor.png` (grayscale) + `collect-4-good-logo.png`
**Note:** Custom (not in the registry). Used `pyt-wordmark` anchor for wordmark-style emblem cue. Different from `big-hit` — this is a persistent tile background, not a triggered celebration.

---

## 7. `pyt` — Pick Your Team badge (transparent, 1024x1024)

> A transparent die-cut crest/shield emblem badge for a WNBA women's basketball card break livestream, in a bold 3D sports/esports broadcast style. It reads "PYT" huge in the center with "PICK" small above and "YOUR TEAM" small below, all in beveled metallic letters. No mascot character; carry the Collect 4 Good brand's finish — clean white sans-serif wordmark treatment and segmented cyan ring badge motif — as the crest's structural cue. Feature WNBA women's basketball iconography: a stylized basketball, a subtle hint of a hoop or court seam, faint suggestions of team jersey stripes around the crest edges (not specific to any franchise). Primary color bright cyan #4FB6E0, secondary pure white #FFFFFF, deep cyan #1A6E9B for gradient depth, with chrome-white highlights and hard black outlines. Glossy 3D lettering, dramatic rim lighting, layered composition, explosive cyan energy burst radiating behind the shield, premium merch-quality die-cut edge. Small 'COLLECT 4 GOOD' lockup may integrate into the top of the crest, spelled EXACTLY as in the provided logo. Transparent background, die-cut emblem only, clean alpha edge, no rectangular backdrop. NOT flat, NOT hand-sketched, NOT warm orange or gold or magenta. Crisp, high-resolution, premium and punchy, readable from a distance.

**Model:** `gpt-image-1.5`
**Anchors:** `_build/anchors/pyt-anchor.png` (grayscale) + `collect-4-good-logo.png`

---

## Rough cost estimate

Assuming quality=high on all 7 outputs:
- 2 opaque scenes (`promo`, `overlay-bg`) on `gpt-image-2` @ 1536×1024 ≈ $0.15 each = **$0.30**
- 5 transparent badges on `gpt-image-1.5` @ 1024×1024 @ high ≈ $0.13 each = **$0.65**
- **Total ≈ $1.00 for the batch.**

Add ~$0.15 per re-roll after eyeballing.

## To run

1. Ensure `OPENAI_API_KEY` is set (`setx OPENAI_API_KEY "sk-..."` then open a new terminal for permanence, or the `.bat` will prompt for it once).
2. Open `_drafts/collect-4-good/` in Explorer (the CLIENT folder, NOT `_build/`).
3. Double-click `run-graphics.bat`.
4. When it finishes, all 7 PNGs land right there in `_drafts/collect-4-good/` — exactly where the overlay HTML references them.

Note: `run-graphics.bat` and `generate_graphics.py` sit in the client folder. `manifest.json`, `PROMPTS.md`, and `anchors/` sit in the `_build/` subfolder. The script computes the manifest path from its own location, so keep the two files in the client folder — moving them into `_build/` will make the script look for `_build/_build/manifest.json` and fail.

## To re-roll after eyeballing

Edit the specific graphic's `prompt` in `manifest.json`, then run:
```
python generate_graphics.py --only stash-or-pass --force
```
