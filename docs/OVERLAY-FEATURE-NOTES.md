# Overlay feature notes — nuance, one-offs and reusable patterns

**Started 2026-08-18. Owner: Mike.**

Why this file exists: the Standard says what every overlay MUST do. The troubleshooting skill
says what to do when one breaks. Neither captures the *judgement calls* behind one-off features
built for a single client — the reasons a thing is shaped the way it is, and the trap that made
us shape it that way. Without this, the next build either reinvents the feature or repeats the
mistake.

**How to use it.** Before building a seller-facing control, search here first. If you build
something new, add an entry. If you hit a non-obvious constraint, write down the constraint, not
just the code.

---

## Sold celebration (card flies from tile, lands under the camera)

**Canonical source: `overlays/btc/index.html`.** Clone it. Do not write a new one.

Parts: `.sell-pop` tile pulse, `#soldFxLayer`, `.sold-fx-strike` streak, and a `.sold-fx-card`
that flips in, holds, and fades. Rename the `bd*` keyframes per client to avoid collisions and
retint to the client's palette.

**Two constraints that are not obvious:**

1. **The card must land BELOW the camera frame, never on it.** The OBS facecam source sits on
   top of that area, so a card landing on the camera centre is completely invisible on stream.
   Land it centred horizontally on `#camFrame`, vertically over `#bottomGrid`, then clamp so it
   can never drift back under the camera or off the bottom of the overlay.
2. **`#soldFxLayer` must be a direct child of `<body>`, OUTSIDE `.overlay`.** `.overlay` has
   `overflow:hidden` and will clip the card mid-flight.

**Timing that reads well on stream:** ~650ms flying in, ~2000ms held, ~470ms out. Verified by
sampling inside `page.evaluate` against `performance.now()` — **not** with Playwright
screenshots, whose per-shot overhead distorts wall clock enough to make a held animation look
absent.

**Deliberate deviation on Heat Check:** BTC defers adding the `.sold` class until the card lands,
for the reveal. Heat Check applies state and class immediately and plays the card on top, because
its `toggleTeam()` calls `updateStats()` straight after `markSold()` — deferring would show
"1 SOLD" while the tile still looked unsold. Pick per client, and know why.

Guard every celebration with a "was it already sold" check so it fires on genuine new sales only,
never on a re-render, sport switch, or replayed SSE event.

---

## Promo banner: single image, seller-editable messages

**Canonical source: `overlays/blue-light-rips/index.html`.**

One background image plus a seller-editable message list, a transition timer in seconds, and
pills added to the `.sold-top` bar.

**Traps:**

- **The `.main` class collision** (see Standard §20). The banner message div is `class="main"`,
  same as the layout container. Scope the layout rule to `.overlay > .main` or the text will
  centre inside a 255px grid column and look permanently off-centre.
- **Never size text with `el.scrollWidth`.** For a stretched block, `scrollWidth` never reports
  less than `clientWidth`, so a shrink-to-fit loop silently runs to its floor and every message
  renders at minimum size. Measure with an **off-screen ruler node** that copies font-family,
  weight, letter-spacing and size.
- **The ruler must live outside any transformed ancestor.** Banner slides carry a `rotateX` flip,
  and any on-element measurement inherits that transform.
- **Auto-fit, don't wrap.** Sellers type arbitrary length. Step the font down from 36px to a ~20px
  floor to keep one line, and only then allow wrapping, shrinking further to fit banner height.

**Text over busy artwork:** `-webkit-text-stroke` **with `paint-order: stroke fill`**. Without
`paint-order` the stroke paints over the fill and thins the letterforms.

**Fonts:** OBS Chromium has no network access for fonts. Offer installed stacks only (Arial Black,
Impact, Trebuchet, Georgia, Courier, system sans) via a `--brandFont` variable. Anything else
silently falls back. Heat Check later dropped the picker entirely and fixed the font at `:root` —
fewer knobs was the better answer for that seller.

---

## Facecam background: image or looping video

Default to the client's art; let the seller override.

- Video: `<video autoplay loop muted playsinline>`. `muted` is required or autoplay is blocked.
- Seller override via `FileReader` → dataURL in localStorage, with a Reset that restores the
  default. When an override is set, hide the video and show the image; on reset, reverse it.
- **Keep source video under ~2–3 Mbps.** Heat Check's arrived at 17.7 Mbps / 17.8 MB for 8
  seconds, for a frame that renders around 500×300. That bloats a GitHub Pages repo for no
  visible gain.
- **Testing caveat:** Playwright's bundled Chromium has **no proprietary codecs**, so an H.264
  mp4 fails to play in a headless test while working perfectly in OBS CEF. Prove the wiring with
  a VP9/WebM transcode rather than concluding the markup is broken.

---

## Chasers: per-sport, never one global pool

The sms family shipped a single `chasersSet` mixing NBA, NFL and MLB codes, so "Chasers Left"
showed the same total on every board including teams not on it.

Correct shape is `chasersBySport` keyed by sport, with a one-time migration routing any old flat
list into the sports that actually own each code. **A code can legitimately be a chaser in more
than one sport** — HOU, SF, KC and BOS all exist in multiple leagues — so route by membership,
not by first match.

**Colour semantics:** chaser markers are **gold**, never the brand accent, because the brand
colour is already the sold treatment. A red chaser ring beside a red sold ✕ is ambiguous
mid-break. A sold chaser dims its gold and stops its pulse so "sold" always wins visually.

Attach the marker to a child element (the unused `.fx` layer works well), not a pseudo-element,
so it cannot collide with the sold `::after`.

---

## Randomizer wheel (blue-light-rips)

**Refresh means reset.** `refreshWheelEntries()` originally rebuilt the list while still
filtering `wheelExcluded`, so spots removed with "Remove Spot" never came back and Refresh
appeared to do nothing. Refresh now clears `wheelExcluded` and zeroes rotation — but **keeps
seller-typed custom spots**, since deleting those on a Refresh would be destructive and
unexpected.

**Anything that should follow the wheel must be a CHILD of the wheel.** The winner banner was
`position:fixed` at a hardcoded `50%/52%` and read `--wheel-size`, which is set on
`#wheel-float`. Because the banner was not a descendant it never saw the variable and always
used the 420px fallback — so it neither moved when the wheel was dragged nor scaled when it was
resized. Making it a child of `#wheel-float` at `top:100%` fixed both symptoms at once.

General rule: if a CSS variable is set on an element by JS, only that element's **subtree** can
read it. Siblings silently get the fallback.

---

## Hidden seller toggles

Sellers want to hide panels on stream without a visible button.

Pattern: a `position:fixed` hotspot in a screen corner, `opacity:0`, `background:transparent`,
very high `z-index`, ~74×44px. Invisible on stream, easy to hit.

**Keep separate toggles genuinely separate.** Blue Light Rips has the Sold-stat toggle for the
whole admin panel and, since 2026-08-18, a top-left hotspot that hides **only** the buyer/team
grid (`#soldGrid`) while leaving the admin pill row visible. Persist each choice under its own
localStorage key so one cannot clobber the other.

---

## Stat visibility toggles

When hiding a stat box from a fixed grid, collapse the grid too. Hiding `#highBidBox` in a
5-column `.controls` row leaves a gap; a `.no-highbid` class that drops the row to 4 columns
keeps Left and Sold balanced. Persist the choice.

---

## Image fallbacks

**Never `d.textContent = code`.** It wipes every child of the tile — the `.fx` layer, the CHASE
tag, any badge. Append a `.fallback-code` element instead and remove the failed `<img>`.
Standard §14. This bug is present in `blue-light-rips` and was in `sms`.

---

## Theming: `--primary` / `--secondary`

Declare both at `:root` and **alias them onto the family's own variables**. Keep the family
variable names and every rule that consumes them.

**Judgement call worth recording:** the Standard's example aliases `--secondary` onto the
background, which works when the second colour is near-black. For tyschap_breakz the second
colour was a vivid purple `#BE38F3` — aliasing it onto the page background would have been
unreadable, so it was aliased onto the **second accent** instead. Read the colour before
following the example literally.

Every build needs visible contrast variance. No flat single-colour designs.
