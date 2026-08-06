#!/usr/bin/env python3
"""
TSU Graphic Generator - local runner.

Runs on Mike's machine (NOT in Cowork - the sandbox can't reach OpenAI). Reads
_build/manifest.json next to this script and generates one PNG per graphic with
OpenAI GPT Image models, using the client's logo as a brand reference image.

Standard library only - no pip install required.

Usage:
    python generate_graphics.py                 # generate everything missing
    python generate_graphics.py --force         # regenerate all
    python generate_graphics.py --only pyt      # just one graphic (repeatable)
    python generate_graphics.py --only pyt --force
    python generate_graphics.py --list          # list manifest entries
    python generate_graphics.py --dry-run       # show what would run, no API calls

Requires env var OPENAI_API_KEY.
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

API_BASE = "https://api.openai.com/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(HERE, "_build")
MANIFEST = os.path.join(BUILD_DIR, "manifest.json")

# Default model when a manifest/graphic doesn't specify one. gpt-image-1.5 supports
# transparent backgrounds (needed for badges); gpt-image-2 does NOT (use it for opaque art).
DEFAULT_MODEL = "gpt-image-1.5"

# Rough per-image USD estimate: model -> quality -> ~cost at 1024x1024.
COST = {
    "gpt-image-2":      {"low": 0.006, "medium": 0.053, "high": 0.211, "auto": 0.09},
    "gpt-image-1.5":    {"low": 0.009, "medium": 0.034, "high": 0.133, "auto": 0.06},
    "gpt-image-1":      {"low": 0.011, "medium": 0.042, "high": 0.167, "auto": 0.08},
    "gpt-image-1-mini": {"low": 0.005, "medium": 0.011, "high": 0.036, "auto": 0.02},
}


def est_cost(g):
    tbl = COST.get(g.get("_model", DEFAULT_MODEL), COST["gpt-image-1"])
    return tbl.get(g.get("quality", "high"), 0.12) * int(g.get("n", 1))


def die(msg, code=1):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(code)


def load_manifest():
    if not os.path.exists(MANIFEST):
        die("manifest not found at %s" % MANIFEST)
    with open(MANIFEST, "r", encoding="utf-8") as f:
        return json.load(f)


def client_dir(man):
    # output_dir is relative to _build; default ".." = the client folder.
    return os.path.normpath(os.path.join(BUILD_DIR, man.get("output_dir", "..")))


def resolve_logo(man):
    """Return an absolute path to the logo file, downloading from logo_url if needed."""
    cdir = client_dir(man)
    lf = man.get("logo_file")
    if lf:
        p = os.path.join(cdir, lf)
        if os.path.exists(p):
            return p
        print("WARN: logo_file '%s' not found on disk." % lf)
    url = man.get("logo_url")
    if url:
        dest = os.path.join(BUILD_DIR, "_logo.png")
        if not os.path.exists(dest):
            print("Downloading logo from logo_url ...")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "tsu-graphics/1.0"})
                with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as out:
                    out.write(r.read())
            except Exception as e:  # noqa
                die("could not download logo_url: %s" % e)
        return dest
    return None


def _multipart(fields, files):
    """Build a multipart/form-data body. files = list of (fieldname, filepath)."""
    boundary = "----tsu" + uuid.uuid4().hex
    nl = b"\r\n"
    body = bytearray()
    for k, v in fields.items():
        if v is None:
            continue
        body += b"--" + boundary.encode() + nl
        body += ('Content-Disposition: form-data; name="%s"' % k).encode() + nl + nl
        body += str(v).encode() + nl
    for field, path in files:
        fn = os.path.basename(path)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            data = f.read()
        body += b"--" + boundary.encode() + nl
        body += ('Content-Disposition: form-data; name="%s"; filename="%s"'
                 % (field, fn)).encode() + nl
        body += ("Content-Type: %s" % ctype).encode() + nl + nl
        body += data + nl
    body += b"--" + boundary.encode() + b"--" + nl
    return bytes(body), "multipart/form-data; boundary=" + boundary


def _post(url, data, content_type, api_key, timeout=300):
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", "Bearer " + api_key)
    req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def call_openai(g, api_key, logo_path, ref_paths):
    """Call the edits endpoint if we have reference images, else generations."""
    model = g.get("_model", DEFAULT_MODEL)
    common = {
        "model": model,
        "prompt": g["prompt"],
        "size": g.get("size", "1024x1024"),
        "quality": g.get("quality", "high"),
        "n": int(g.get("n", 1)),
    }
    bg = g.get("background")
    supports_transparent = "image-2" not in model  # gpt-image-2 has no transparent bg
    if bg in ("transparent", "opaque", "auto"):
        if bg == "transparent" and not supports_transparent:
            print("   ! %s cannot do transparent backgrounds -> generating OPAQUE."
                  " Set this graphic's \"model\" to gpt-image-1.5 for a real die-cut badge." % model)
        else:
            common["background"] = bg

    if ref_paths:
        files = [("image[]", p) for p in ref_paths]
        body, ctype = _multipart(common, files)
        return _post(API_BASE + "/images/edits", body, ctype, api_key)
    else:
        payload = json.dumps(common).encode("utf-8")
        return _post(API_BASE + "/images/generations", payload, "application/json", api_key)


def with_retries(fn, tries=4):
    delay = 4
    for i in range(tries):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            code = e.code
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:400]
            except Exception:  # noqa
                pass
            if code in (429, 500, 502, 503) and i < tries - 1:
                print("  HTTP %s, retrying in %ss ... %s" % (code, delay, detail[:120]))
                time.sleep(delay)
                delay *= 2
                continue
            die("HTTP %s from OpenAI: %s" % (code, detail))
        except urllib.error.URLError as e:
            if i < tries - 1:
                print("  network error (%s), retrying in %ss ..." % (e.reason, delay))
                time.sleep(delay)
                delay *= 2
                continue
            die("network error reaching OpenAI: %s" % e.reason)


def save_images(resp, out_dir, name, n):
    paths = []
    data = resp.get("data", [])
    for idx, item in enumerate(data):
        b64 = item.get("b64_json")
        if not b64:
            continue
        suffix = "" if n == 1 else "-%d" % (idx + 1)
        out = os.path.join(out_dir, "%s%s.png" % (name, suffix))
        with open(out, "wb") as f:
            f.write(base64.b64decode(b64))
        paths.append(out)
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="regenerate even if output exists")
    ap.add_argument("--only", action="append", default=[], help="only this graphic name (repeatable)")
    ap.add_argument("--list", action="store_true", help="list manifest entries and exit")
    ap.add_argument("--dry-run", action="store_true", help="show plan, make no API calls")
    args = ap.parse_args()

    man = load_manifest()
    cdir = client_dir(man)
    graphics = man.get("graphics", [])
    # resolve the model for each graphic: per-graphic override > manifest default > built-in
    for g in graphics:
        g["_model"] = g.get("model") or man.get("model") or DEFAULT_MODEL

    if args.list:
        print("Client: %s   (%d graphics)" % (man.get("client", "?"), len(graphics)))
        for g in graphics:
            print("  - %-18s %s %-12s %s" % (g["name"], g.get("size", "1024x1024"),
                                             g.get("background", ""), g["_model"]))
        return

    only = set(args.only)
    todo = []
    for g in graphics:
        if only and g["name"] not in only:
            continue
        out = os.path.join(cdir, g["name"] + ".png")
        if os.path.exists(out) and not args.force:
            print("skip  %s (exists; use --force to redo)" % g["name"])
            continue
        todo.append(g)

    if not todo:
        print("Nothing to generate.")
        return

    est = sum(est_cost(g) for g in todo)
    print("Client: %s" % man.get("client", "?"))
    print("To generate: %s" % ", ".join(g["name"] for g in todo))
    print("Estimated cost: ~$%.2f (rough)" % est)

    if args.dry_run:
        print("(dry run - no API calls made)")
        return

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        die("OPENAI_API_KEY not set. See references/openai-gpt-image.md for setup.")

    logo_path = resolve_logo(man)
    if logo_path:
        print("Logo reference: %s" % os.path.basename(logo_path))
    else:
        print("WARN: no logo available - generating without a brand reference image.")

    ok, fail = [], []
    for g in todo:
        name = g["name"]
        # Resolve this graphic's reference images (default: the logo).
        refs = []
        for r in g.get("reference_images", []):
            rp = os.path.join(cdir, r)
            if os.path.exists(rp):
                refs.append(rp)
        if not refs and logo_path and g.get("reference_images") != []:
            refs = [logo_path]
        print("\n>> %s  (%s, %s, q=%s, model=%s, refs=%d)" % (
            name, g.get("size", "1024x1024"), g.get("background", "-"),
            g.get("quality", "high"), g["_model"], len(refs)))
        try:
            resp = with_retries(lambda: call_openai(g, api_key, logo_path, refs))
            paths = save_images(resp, cdir, name, int(g.get("n", 1)))
            if paths:
                for p in paths:
                    print("   saved %s" % os.path.relpath(p, cdir))
                ok.append(name)
            else:
                print("   no image returned")
                fail.append(name)
        except SystemExit:
            raise
        except Exception as e:  # noqa
            print("   FAILED: %s" % e)
            fail.append(name)

    print("\nDone. %d ok, %d failed." % (len(ok), len(fail)))
    if fail:
        print("Failed: %s" % ", ".join(fail))
        sys.exit(2)


if __name__ == "__main__":
    main()
