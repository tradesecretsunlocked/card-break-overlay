#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time cleanup: stop tracking files that have no business on GitHub.
# Generated 2026-08-18. RUN THIS LOCALLY (git does not work from a Cowork
# session — the mounted folder has no network egress and cannot unlink
# .git/index.lock).
#
# This does NOT delete anything from your disk. --cached only removes files
# from git's index, so they stop being published and stop growing the repo.
#
# It also does NOT shrink the existing clone: the blobs stay in history.
# Reclaiming that needs a history rewrite (git-filter-repo / BFG), which is a
# separate, more disruptive decision. See the note at the bottom.
#
# Verified before generating:
#   - 0 live overlays (overlays/<client>/index.html) are affected
#   - 0 of the excluded media files are referenced by any live overlay
#   - the h-vault nested package is a self-contained duplicate the live
#     h-vault overlay never references
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")" || exit 1

echo "Files currently tracked that the new .gitignore excludes:"
git ls-files | git check-ignore --stdin --no-index | wc -l
echo
read -r -p "Untrack them all? (y/N) " ans
[ "$ans" = "y" ] || { echo "aborted"; exit 0; }

# Untrack everything the new .gitignore matches, in one pass.
git ls-files | git check-ignore --stdin --no-index \
  | tr '\n' '\0' \
  | xargs -0 -r git rm --cached --quiet --

echo
echo "Done. Review before committing:"
echo "  git status --short | head -40"
echo
echo "Then:"
echo "  git add .gitignore"
echo "  git commit -m 'Untrack local-only build artifacts, drafts, extensions and unreferenced media'"
echo "  git push"
echo
echo "AFTER PUSHING, verify GitHub Pages still serves a live overlay, e.g.:"
echo "  https://<pages-domain>/overlays/blue-light-rips/index.html"
echo
echo "─────────────────────────────────────────────────────────────────────"
echo "History note: this stops future growth and removes the files from the"
echo "GitHub file listing, but ~900 MB of blobs remain in history, so a fresh"
echo "clone is still large. If you want that reclaimed, that is a separate"
echo "git-filter-repo pass and it rewrites every commit hash."
