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
    a = ap.parse_args()

    out = os.path.join(SRC, "_builds", a.slug)
    if os.path.exists(out): shutil.rmtree(out)
    os.makedirs(out)
    for item in os.listdir(SRC):
        if item in SKIP: continue
        s = os.path.join(SRC, item); d = os.path.join(out, item)
        shutil.copytree(s, d) if os.path.isdir(s) else shutil.copy2(s, d)

    sub(os.path.join(out, "content.js"), [
        ('"REPLACE_WITH_CLIENT_UUID_FROM_SUPABASE"', f'"{a.key}"'),
        ('"REPLACE_WITH_CLIENT_SLUG-overlay"',       f'"{a.overlay_id}"'),
        ('sport:        "nil"',                      f'sport:        "{a.sport}"'),
    ])
    bot_pairs = [('"REPLACE_WITH_CLIENT_KEY"', f'"{a.key}"')]
    if a.seller:
        bot_pairs.append(('"REPLACE_WITH_CLIENT_WHATNOT_HANDLE"', f'"{a.seller.lower().lstrip("@")}"'))
    sub(os.path.join(out, "bot-content.js"), bot_pairs)

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
