#!/usr/bin/env sh
# Rebuilds every cache the site serves instead of asking TaxonWorks live,
# commits them and, after asking, pushes. Run from anywhere:
# ./scripts/update-caches.sh   (or only build them: npm run caches)
#
#   1. map shapes        public/map-shapes/        npm run map-shapes
#   2. country checklists public/checklists/       npm run checklists
#                        (after 1: it names each country's cached outline)
#   3. home slideshow    public/images/random/,    npm run random-images
#                        components/randomImagePool.json (needs ImageMagick 7)
set -eu

cd "$(dirname "$0")/.."

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 ('magick') is not installed (needed for the slideshow)." >&2
  exit 1
fi

# origin can be ahead when pages were edited on GitHub
git pull --rebase --autostash

npm run caches

CACHES="public/map-shapes public/checklists public/images/random components/randomImagePool.json"
# shellcheck disable=SC2086
git add $CACHES

# shellcheck disable=SC2086
if git diff --cached --quiet -- $CACHES; then
  echo "Caches unchanged, nothing to commit."
  exit 0
fi

# shellcheck disable=SC2086
git diff --cached --stat -- $CACHES | tail -n 1
# Only the caches, even if other changes are staged.
# shellcheck disable=SC2086
git commit -m "Refresh cached data" -- $CACHES

printf "Push to origin now? [y/N] "
# No terminal (cron, CI): read fails, answer stays empty, nothing is pushed.
read -r answer || answer=
case "$answer" in
  y|Y) git push ;;
  *) echo "Not pushed. Run 'git push' when ready." ;;
esac
