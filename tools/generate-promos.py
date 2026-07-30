#!/usr/bin/env python3
"""
TSU — Promo Graphics Generator
================================
Generates branded stream promo PNGs for a client using the OpenAI gpt-image-1 API.
One command produces all standard promo types with transparent backgrounds, sized
and ready to drop into the client's overlay package.

Usage (CLI args):
    python generate-promos.py \
        --client "Flatbill Sports" \
        --slug "flatbill-sports" \
        --primary "#7CFF00" \
        --secondary "#000000" \
        --style "vault-crest badge, hyper-realistic 3D CGI, neon glow" \
        [--extra "Mystery Pack" "Group Break"]

Output:
    _drafts/{slug}/graphics/
        stash-or-pass.png
        see-2-pick-1.png
        see-3-pick-1.png
        pyt.png
        <any extra types>.png
        _prompts/  (prompt text saved alongside each image for reference)

Requirements:
    pip install openai python-dotenv

Environment variables (or .env in repo root):
    OPENAI_API_KEY=sk-...
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from pathlib import Path

# ── optional deps ────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

try:
    from openai import OpenAI
except ImportError:
    sys.exit("ERROR: openai package not installed. Run: pip install openai")

# ─────────────────────────────────────────────────────────────────────────────
# Standard promo types
# Each entry: (slug, display_name, subtitle, visual_concept)
# ─────────────────────────────────────────────────────────────────────────────
STANDARD_PROMOS = [
    (
        "stash-or-pass",
        "STASH OR PASS",
        "KEEP IT OR MOVE ON",
        "vault-style shield crest. The concept is a decision — keep the card or pass it on. "
        "Visual motifs: a vault door, a hand weighing two choices, a bold decision badge."
    ),
    (
        "see-2-pick-1",
        "SEE 2 PICK 1",
        "YOU SEE TWO · YOU PICK ONE",
        "hexagonal badge shape. The concept is selection — you see two cards and choose one. "
        "Visual motifs: two glowing card slots, a selection reticle or arrow, dual-choice energy."
    ),
    (
        "see-3-pick-1",
        "SEE 3 PICK 1",
        "YOU SEE THREE · YOU PICK ONE",
        "triangular or tri-panel badge design. The concept is selective choice from three options. "
        "Visual motifs: three glowing card slots arranged in a triangle, a spotlight on one."
    ),
    (
        "pyt",
        "PYT",
        "PICK YOUR TEAM",
        "bold sports-energy emblem. The concept is team selection — the buyer picks their team. "
        "Visual motifs: a sports arena spotlight, a roster board, bold team-select energy. "
        "PYT stands for Pick Your Team — full words should NOT appear in the graphic."
    ),
]


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def hex_to_name(hex_color):
    """Return a loose English description of a hex color for the prompt."""
    h = hex_color.lstrip("#").upper()
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        return hex_color
    if r > 200 and g > 200 and b > 200:
        return f"bright white ({hex_color})"
    if r < 50 and g < 50 and b < 50:
        return f"deep black ({hex_color})"
    if r > g and r > b:
        return f"red-family ({hex_color})"
    if g > r and g > b:
        return f"green-family ({hex_color})"
    if b > r and b > g:
        return f"blue-family ({hex_color})"
    if r > 200 and g > 150 and b < 80:
        return f"gold/orange ({hex_color})"
    return hex_color


def build_prompt(client_name, primary, secondary, promo_slug, promo_name, subtitle, concept, extra_style=""):
    primary_desc  = hex_to_name(primary)
    secondary_desc = hex_to_name(secondary)

    style_note = extra_style.strip() if extra_style else (
        "hyper-realistic product render, 3D CGI, ultra-high detail, game UI aesthetic, "
        "cinematic lighting, no flat surfaces — every surface has specularity or glow"
    )

    return f"""A bold, hyper-realistic 3D emblem graphic for a sports card break stream. \
Central design is a {concept}

The badge/emblem face displays the text "{promo_name}" in massive, all-caps extruded 3D letterforms \
with a metallic {primary_desc} chrome finish and electric glow halos radiating off each letter edge. \
Below the main title, a {primary_desc} horizontal rule (glowing laser line) divides the subtitle \
"{subtitle}" in compact condensed military stencil lettering.

Color palette: {primary_desc} as the dominant accent color, {secondary_desc} as the base/body color. \
All metallic trim, glow effects, energy arcs, and lettering accents use {primary_desc}. \
The badge body, shadows, and background elements use {secondary_desc}.

Subtle "{client_name}" branding worked into the lower base of the crest as small engraved text.

Style: {style_note}

Background: fully transparent (alpha channel). No background fill, no glow halos extending \
beyond the badge silhouette. The graphic should be a self-contained badge/emblem shape \
that can be placed on any background.

Do NOT include: human figures, hands, real sports team logos, real player likenesses, \
watermarks, soft gradients, or pastel colors.

Aspect ratio: 1:1 square."""


# ─────────────────────────────────────────────────────────────────────────────
# Image generation
# ─────────────────────────────────────────────────────────────────────────────
def generate_image(client, prompt_text, output_path, prompt_save_path, dry_run=False):
    """Call OpenAI gpt-image-1, save PNG with transparency."""
    print(f"  Generating: {output_path.name} ...", end=" ", flush=True)

    if dry_run:
        # Save prompt only, skip API call
        prompt_save_path.write_text(prompt_text, encoding="utf-8")
        print("(dry-run — prompt saved)")
        return True

    try:
        response = client.images.generate(
            model="gpt-image-1",
            prompt=prompt_text,
            size="1024x1024",
            quality="high",
            # gpt-image-1 returns b64_json by default; transparent background
            # requires no background fill in the prompt — the model respects it
            n=1,
        )

        b64 = response.data[0].b64_json
        if not b64:
            print("FAILED — no image data returned")
            return False

        img_bytes = base64.b64decode(b64)
        output_path.write_bytes(img_bytes)
        prompt_save_path.write_text(prompt_text, encoding="utf-8")
        print(f"saved ({len(img_bytes) // 1024}KB)")
        return True

    except Exception as e:
        print(f"ERROR — {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="TSU Promo Graphics Generator")
    parser.add_argument("--client",    help="Client display name, e.g. 'Flatbill Sports'")
    parser.add_argument("--slug",      help="Client folder slug, e.g. 'flatbill-sports'")
    parser.add_argument("--primary",   help="Primary brand color hex, e.g. '#7CFF00'")
    parser.add_argument("--secondary", default="#000000", help="Secondary color hex (default: #000000)")
    parser.add_argument("--style",     default="", help="Optional extra style notes for all prompts")
    parser.add_argument("--extra",     nargs="*", default=[], help="Extra promo type names beyond the 4 standards")
    parser.add_argument("--output-dir", help="Override output directory (default: _drafts/{slug}/graphics)")
    parser.add_argument("--dry-run",   action="store_true", help="Build prompts only — don't call the API")
    parser.add_argument("--only",      nargs="*", help="Generate only specific promo slugs, e.g. --only pyt stash-or-pass")
    args = parser.parse_args()

    # ── Gather branding ──────────────────────────────────────────────────────
    if not args.client or not args.primary:
        parser.error("Provide --client and --primary")
    client_name = args.client
    slug        = args.slug or slugify(client_name)
    primary     = args.primary
    secondary   = args.secondary
    style_notes = args.style
    extra_types = args.extra or []

    # ── Output folder ────────────────────────────────────────────────────────
    repo_root  = Path(__file__).parent.parent
    if args.output_dir:
        out_dir = Path(args.output_dir)
    else:
        out_dir = repo_root / "_drafts" / slug / "graphics"
    prompt_dir = out_dir / "_prompts"
    out_dir.mkdir(parents=True, exist_ok=True)
    prompt_dir.mkdir(parents=True, exist_ok=True)

    # ── Build promo list ─────────────────────────────────────────────────────
    promos = list(STANDARD_PROMOS)

    for extra_name in extra_types:
        extra_slug = slugify(extra_name)
        promos.append((
            extra_slug,
            extra_name.upper(),
            extra_name.upper(),
            f"bold sports badge design representing the '{extra_name}' game type. "
            f"Visual motifs: dynamic energy, bold badge shape, sport card break aesthetic."
        ))

    if args.only:
        promos = [(s, n, sub, c) for s, n, sub, c in promos if s in args.only]
        if not promos:
            sys.exit(f"No promos matched --only filter: {args.only}")

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  TSU Promo Generator")
    print(f"  Client  : {client_name}")
    print(f"  Slug    : {slug}")
    print(f"  Primary : {primary}")
    print(f"  Secondary: {secondary}")
    print(f"  Output  : {out_dir}")
    print(f"  Promos  : {', '.join(s for s, *_ in promos)}")
    if args.dry_run:
        print(f"  Mode    : DRY RUN (prompts only, no API calls)")
    print(f"{'='*60}\n")

    # ── OpenAI client ─────────────────────────────────────────────────────────
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key and not args.dry_run:
        sys.exit("ERROR: OPENAI_API_KEY env var not set")
    openai_client = OpenAI(api_key=api_key) if api_key else None

    # ── Generate ─────────────────────────────────────────────────────────────
    results = []
    for i, (promo_slug, promo_name, subtitle, concept) in enumerate(promos):
        prompt = build_prompt(
            client_name=client_name,
            primary=primary,
            secondary=secondary,
            promo_slug=promo_slug,
            promo_name=promo_name,
            subtitle=subtitle,
            concept=concept,
            extra_style=style_notes,
        )

        png_path    = out_dir / f"{promo_slug}.png"
        prompt_path = prompt_dir / f"{promo_slug}.txt"

        ok = generate_image(
            client=openai_client,
            prompt_text=prompt,
            output_path=png_path,
            prompt_save_path=prompt_path,
            dry_run=args.dry_run,
        )
        results.append((promo_slug, ok))

        # Brief pause between API calls to avoid rate-limiting
        if not args.dry_run and i < len(promos) - 1:
            time.sleep(2)

    # ── Report ───────────────────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    passed = sum(1 for _, ok in results if ok)
    print(f"Done: {passed}/{len(results)} generated")
    for slug_r, ok in results:
        print(f"  {'✓' if ok else '✗'} {slug_r}")
    if not args.dry_run:
        print(f"\nPNGs saved to: {out_dir}")
    print(f"Prompts saved to: {prompt_dir}")


if __name__ == "__main__":
    main()
