#!/usr/bin/env python3
"""
TSU unified extension — per-client build.

  python3 bake-client.py --slug rippin-n-sippin \
      --key b4ab23b1-8ca4-4dcd-9238-43113a6e5c88 \
      --overlay-id rippin-n-sippin-overlay --sport nfl [--seller rippinsippin]

Bakes the bridge key into BOTH halves (sales + bot) and zips a ready-to-install
folder. --seller is OPTIONAL: bot_configs.seller_username in Supabase overrides it.
"""
import argparse, os, re, shutil, sys, zipfile

SRC = os.path.dirname(os.path.abspath(__file__))
SKIP = {"bake-client.py", "_builds", "__pycache__"}

def sub(path, pairs):
    with open(path, encoding="utf-8") as f: t = f.read()
    for old, new in pairs:
        if old not in t: print(f"   ! not found in {os.path.basename(path)}: {old[:40]}")
        t = t.replace(old, new)
    with open(path, "w", encoding="utf-8") as f: f.write(t)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--overlay-id", required=True)
    ap.add_argument("--sport", default="nil")
    ap.add_argument("--seller", default="")
    # 2026-09-15: sendUnresolved is per-BOARD, not per-client, and the template
    # ships `true`. True means "forward a sale whose title matched nothing" — right
    # for name-matched boards (repack/custom spots), WRONG for a team-code board,
    # where it lets junk titles fuzzy-land on a tile. Default to the conservative
    # value and make the risky one an explicit choice.
    ap.add_argument("--send-unresolved", choices=["true", "false"], default="false")
    a = ap.parse_args()

    if not a.seller:
        sys.exit("REFUSING TO BUILD: --seller is required.\n"
                 "  The sales half's ownership gate fails CLOSED. Without the exact\n"
                 "  Whatnot handle the extension captures NOTHING and says so only in\n"
                 "  the console. Verify at https://www.whatnot.com/user/<handle> first.")

    out = os.path.join(SRC, "_builds", a.slug)
    if os.path.exists(out): shutil.rmtree(out)
    os.makedirs(out)
    for item in os.listdir(SRC):
        if item in SKIP: continue
        s = os.path.join(SRC, item); d = os.path.join(out, item)
        shutil.copytree(s, d) if os.path.isdir(s) else shutil.copy2(s, d)

    seller = a.seller.lower().lstrip("@").strip()

    sub(os.path.join(out, "content.js"), [
        ('"REPLACE_WITH_CLIENT_UUID_FROM_SUPABASE"', f'"{a.key}"'),
        ('"REPLACE_WITH_CLIENT_SLUG-overlay"',       f'"{a.overlay_id}"'),
        ('sport:        "nil"',                      f'sport:        "{a.sport}"'),
        # 2026-09-15 BUGFIX: the seller handle was baked into bot-content.js ONLY,
        # so every build this script produced shipped the SALES half still holding
        # "REPLACE_WITH_CLIENT_WHATNOT_HANDLE". The ownership gate fails closed on
        # that, meaning zero sales captured, with nothing but a console line to say
        # why. Existing per-client builds were hand-patched after the fact; this is
        # the actual fix.
        ('"REPLACE_WITH_CLIENT_WHATNOT_HANDLE"',     f'"{seller}"'),
        ('sendUnresolved: true',                     f'sendUnresolved: {a.send_unresolved}'),
        # the template's key line carries a stale per-client comment; drop it so the
        # build does not claim to belong to a different client
        ('   // Wizards Trading Cards (WCB / Luis)', f'   // {a.slug}'),
    ])
    sub(os.path.join(out, "bot-content.js"), [
        ('"REPLACE_WITH_CLIENT_KEY"',            f'"{a.key}"'),
        ('"REPLACE_WITH_CLIENT_WHATNOT_HANDLE"', f'"{seller}"'),
    ])

    # Never ship scratch copies of the template to a client. content.js.OLD-v2.2.1
    # predates the seller ownership gate entirely — 31 KB of the exact code that
    # caused the 2026-08-11 data-integrity incident, sitting in a delivery zip.
    for junk in os.listdir(out):
        if re.search(r"\.(OLD|bak)[-.\w]*$", junk) or junk.endswith("~"):
            os.remove(os.path.join(out, junk))
            print(f"   dropped scratch file: {junk}")

    # Fail loudly rather than hand over a silently-dead extension.
    leftovers = []
    for fn in ("content.js", "bot-content.js"):
        p = os.path.join(out, fn)
        if not os.path.exists(p): continue
        with open(p, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if "REPLACE_WITH_CLIENT" in line and "startsWith" not in line:
                    leftovers.append(f"{fn}:{i}: {line.strip()[:70]}")
    if leftovers:
        shutil.rmtree(out, ignore_errors=True)
        sys.exit("BUILD FAILED — unbaked placeholders remain:\n  " + "\n  ".join(leftovers))

    zpath = os.path.join(SRC, "_builds", f"{a.slug}-extension.zip")
    if os.path.exists(zpath): os.remove(zpath)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(out):
            for fn in files:
                fp = os.path.join(root, fn)
                z.write(fp, os.path.join(a.slug, os.path.relpath(fp, out)))
    print(f"built  {out}")
    print(f"zip    {zpath}")
    if not a.seller:
        print("NOTE: no --seller baked. Set bot_configs.seller_username in Supabase or the bot will not post.")

if __name__ == "__main__": main()
