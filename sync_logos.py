#!/usr/bin/env python3
"""
TSU logo sync — intake step.

Pulls each client's uploaded logo out of Supabase storage and puts a correctly
named copy in the TWO places the pipeline reads from:

  1. images/logos/<slug>-logo.png        the overlay asset (resolved through BASE)
  2. graphics/<slug>/_build/_logo.png    the graphic generator's brand reference

Why this exists: neither the Cowork container nor the device shell has egress to
Supabase storage, so the agent cannot place these files itself. This runs on your
machine, where the network works. Standard library only.

Filenames are forced LOWERCASE. GitHub Pages is case sensitive and Windows is not,
so an uppercase .PNG works locally and 404s live. images/logos already contains one
of those (h-vault-logo.PNG).

Usage:
    python sync_logos.py                 # fetch anything missing
    python sync_logos.py --force         # re-fetch everything
    python sync_logos.py --only samoxin  # one client (repeatable)
    python sync_logos.py --dry-run
"""
import argparse, json, os, shutil, struct, sys, urllib.request, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "logo-sync.json")


def find_repo_root(start):
    """Walk up until we see the repo's marker folders."""
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isdir(os.path.join(d, "images")) and os.path.isdir(os.path.join(d, "overlays")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def png_info(path):
    """Dimensions + whether the PNG declares an alpha channel. No pillow needed."""
    try:
        with open(path, "rb") as f:
            sig = f.read(8)
            if sig != b"\x89PNG\r\n\x1a\n":
                return None
            f.read(4); f.read(4)                      # IHDR length + type
            w, h, _depth, color = struct.unpack(">IIBB", f.read(10))
            return dict(w=w, h=h, alpha=color in (4, 6))
    except Exception:
        return None


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "tsu-logo-sync"})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200:
            raise RuntimeError("HTTP %s" % r.status)
        data = r.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("not a PNG (got %r)" % data[:8])
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--repo", help="path to card-break-overlay if autodetect fails")
    a = ap.parse_args()

    repo = a.repo or find_repo_root(HERE)
    if not repo:
        print("ERROR: could not find the card-break-overlay repo root.")
        print("       Put this script inside the repo, or pass --repo <path>.")
        return 2
    print("repo: %s\n" % repo)

    man = json.load(open(MANIFEST, encoding="utf-8"))
    clients = man["clients"]
    if a.only:
        clients = [c for c in clients if c["slug"] in a.only]
        if not clients:
            print("no client matched --only %s" % a.only); return 2

    warn = []
    for c in clients:
        slug = c["slug"]
        overlay_dest = os.path.join(repo, "images", "logos", "%s-logo.png" % slug)
        gfx_dest = os.path.join(repo, "graphics", slug, "_build", "_logo.png")

        have = os.path.exists(overlay_dest)
        if have and not a.force:
            info = png_info(overlay_dest)
            print("%-24s SKIP (exists) %s" % (slug, info or ""))
        elif a.dry_run:
            print("%-24s would fetch -> %s" % (slug, overlay_dest)); continue
        else:
            try:
                n = fetch(c["logo_url"], overlay_dest)
                print("%-24s fetched %d bytes -> images/logos/%s-logo.png" % (slug, n, slug))
            except Exception as e:
                print("%-24s FAILED: %s" % (slug, e)); warn.append((slug, "fetch failed: %s" % e)); continue

        if not a.dry_run:
            os.makedirs(os.path.dirname(gfx_dest), exist_ok=True)
            shutil.copyfile(overlay_dest, gfx_dest)
            print("%-24s copied      -> graphics/%s/_build/_logo.png" % ("", slug))

            info = png_info(overlay_dest)
            if info:
                print("%-24s %dx%d  alpha=%s" % ("", info["w"], info["h"], info["alpha"]))
                if not info["alpha"]:
                    warn.append((slug, "OPAQUE: no alpha channel. It will render as a solid "
                                       "rectangle in the overlay header, not a die-cut mark."))
                if max(info["w"], info["h"]) > 1600:
                    warn.append((slug, "very large (%dx%d) for a header logo" % (info["w"], info["h"])))
        print()

    if warn:
        print("=" * 66)
        print("REVIEW BEFORE PROMOTING:")
        for slug, w in warn:
            print("  - %-22s %s" % (slug, w))
    return 0


if __name__ == "__main__":
    sys.exit(main())
