#!/usr/bin/env python3
"""
prep_anchor.py - make a grayscale style-anchor from a universal library example.

Runs in Cowork at STAGING time (not on Mike's machine), so Pillow is fine here.
Desaturating a cross-client anchor lets it transfer the TSU texture / lettering /
composition without dragging the source client's colors into the new brand. The
prompt + the client's own (full-color) logo supply the brand palette.

Usage:
    python prep_anchor.py <source_image> <dest_png> [--keep-color]

--keep-color copies the anchor as-is (use only for a SAME-brand approved graphic,
where the colors are already the client's).
"""
import sys
from PIL import Image


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep_color = "--keep-color" in sys.argv
    if len(args) < 2:
        print("usage: python prep_anchor.py <source> <dest.png> [--keep-color]")
        sys.exit(1)
    src, dst = args[0], args[1]
    im = Image.open(src).convert("RGBA")
    if not keep_color:
        # Desaturate the RGB while preserving any alpha (transparent badges).
        r, g, b, a = im.split()
        gray = Image.merge("RGB", (r, g, b)).convert("L")
        im = Image.merge("RGBA", (gray, gray, gray, a))
    # Keep anchors light-weight.
    im.thumbnail((768, 768), Image.LANCZOS)
    im.save(dst, "PNG", optimize=True)
    print("wrote %s (%s)" % (dst, "color" if keep_color else "grayscale"))


if __name__ == "__main__":
    main()
