# Things Claude could not delete — needs your hand

The mounted repo blocks **delete/unlink** (only create and overwrite are permitted), so
anything below had to be left in place or neutralised instead of removed. Nothing here is
load-bearing. Created 2026-09-15.

> **Do NOT delete `.nojekyll`** (repo root). It is 0 bytes *by design* — it tells GitHub
> Pages not to run Jekyll. It shows up in any "empty files" sweep. Leave it.

---

## 1. Ships-to-client risk — delete these two first

`extension-unified\_builds\texazmadesoulja-v3\`

- `content.js.OLD-v2.2.1`
- `content.js.bak-20260914`

These are scratch copies of the template that `bake-client.py` was copying into every client
build folder. `content.js.OLD-v2.2.1` is the **pre-ownership-gate** code — the exact version
behind the 2026-08-11 data-integrity incident. Neither is referenced by `manifest.json`, so
they do nothing when loaded, but they should not sit inside a client deliverable.

**I already overwrote both with a 151-byte retirement notice**, so the dangerous code is gone
even before you delete the files. The **zip is clean** — it was rebuilt from a filtered copy
and contains only the 9 real files. `bake-client.py` now strips these automatically, so no
future build will have them.

## 2. Broken zip — would fail on a client machine

- `extension-unified\_builds\coachs111sports-v3.1.0.zip` — **0 bytes.**

Produced by a `zip` run that wrote directly onto the mount, which silently fails here. If this
ever got sent to Nico it would not open. If you still need a v3.1.0 for Coachs, say so and I
will rebuild it properly (build in `/tmp`, then copy).

## 3. Failed-zip temp artifacts

Left by the same broken-`zip` behaviour. All junk.

- `extension-unified\_builds\zi8YpGd1`
- `extension-unified\_builds\ziPsYQfW`
- `_drafts\birdie-breaks\ziNC0i8B`
- `_drafts\pmm\zit2RQ8M`
- `_drafts\northland-breaks-2\extension - Copy\ziysTnga`

## 4. Melon draft — one stray NUL byte (delete 3 lines, not a file)

`_drafts\melon\index.html` — **line 2073**: `// dead sentinel: "<NUL>TSU_HIT_SLIDE";`

Confirmed: exactly **1** NUL byte in the file, on that line. It is an inert comment that
nothing references, but it makes git and ripgrep treat the entire overlay as a **binary file** —
which means no readable diffs and no text search. It already cost me a wasted search pass this
session.

Delete **line 2073 plus the 4-line `⚠ HOUSEKEEPING` comment block directly above it** (lines
~2069–2073). My editing tools cannot emit a NUL byte, so I cannot match that line to remove it.

## 5. Old git-lock quarantine (optional housekeeping)

Pre-existing, not mine, safe to clear whenever:

- `_drafts\.wtest-delete-me`
- `_drafts\_gitlock-quarantine\` (2 lock files)
- `_to_delete\` — ~15 stale git `index.lock` / `HEAD.lock` files and two 0-byte
  coachs111 zips from the 2026-08-22 attempt.

---

### Why this keeps happening

Two mount restrictions worth knowing, because they cause *silent* wrong results rather than errors:

1. **`zip` writing directly to the mount produces a 0-byte file** and a `zi*` temp turd. Always
   build the zip in `/tmp` and copy it over, then verify by extracting the copy at the
   destination — not the one in `/tmp`.
2. **`rmtree` fails on the mount**, so a re-bake over an existing `_builds\<slug>\` folder
   errors out and **leaves the previous build in place**. It reads like it rebuilt. It did not.
   That is exactly how the first (broken) Texaz v3 bake nearly got shipped.
