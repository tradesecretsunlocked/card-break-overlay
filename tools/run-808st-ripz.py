#!/usr/bin/env python3
"""
808st_ripz — Promo Graphics Runner
Run this once from the repo root to generate all 4 PNGs.

    OPENAI_API_KEY=sk-... python tools/run-808st-ripz.py

Output: _drafts/808st-ripz/graphics/
    stash-or-pass.png
    double-stash-or-pass.png
    spin-2-pick-1.png
    pyt.png
"""

import base64, os, sys, time
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    sys.exit("Run: pip install openai")

API_KEY = os.environ.get("OPENAI_API_KEY") or sys.exit("Set OPENAI_API_KEY env var first")
client  = OpenAI(api_key=API_KEY)

OUT_DIR    = Path(__file__).parent.parent / "_drafts" / "808st-ripz" / "graphics"
PROMPT_DIR = OUT_DIR / "_prompts"
OUT_DIR.mkdir(parents=True, exist_ok=True)
PROMPT_DIR.mkdir(exist_ok=True)

PROMOS = {
    "stash-or-pass": Path(PROMPT_DIR / "stash-or-pass.txt"),
    "double-stash-or-pass": Path(PROMPT_DIR / "double-stash-or-pass.txt"),
    "spin-2-pick-1": Path(PROMPT_DIR / "spin-2-pick-1.txt"),
    "pyt": Path(PROMPT_DIR / "pyt.txt"),
}

print("\n808st_ripz — Generating 4 promo graphics via gpt-image-1...\n")

results = []
for i, (slug, prompt_file) in enumerate(PROMOS.items()):
    if not prompt_file.exists():
        print(f"  ✗ {slug} — prompt file missing: {prompt_file}")
        results.append((slug, False))
        continue

    prompt = prompt_file.read_text(encoding="utf-8")
    out_path = OUT_DIR / f"{slug}.png"
    print(f"  [{i+1}/4] {slug} ...", end=" ", flush=True)

    try:
        resp = client.images.generate(
            model="gpt-image-1",
            prompt=prompt,
            size="1024x1024",
            quality="high",
            n=1,
        )
        img_bytes = base64.b64decode(resp.data[0].b64_json)
        out_path.write_bytes(img_bytes)
        print(f"✓  ({len(img_bytes)//1024}KB) → {out_path.name}")
        results.append((slug, True))
    except Exception as e:
        print(f"✗  ERROR: {e}")
        results.append((slug, False))

    if i < len(PROMOS) - 1:
        time.sleep(3)

passed = sum(1 for _, ok in results if ok)
print(f"\nDone: {passed}/{len(results)} generated → {OUT_DIR}")
