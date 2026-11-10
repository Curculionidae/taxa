#!/usr/bin/env sh
# Rebuilds the home page slideshow pool (public/images/random/ and
# components/randomImagePool.json) from TaxonWorks, commits it and,
# after asking, pushes it. Run from anywhere: ./scripts/update-random-images.sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 ('magick') is not installed." >&2
  exit 1
fi

# origin can be ahead when pages were edited on GitHub
git pull --rebase --autostash

npm run random-images

git add public/images/random components/randomImagePool.json

if git diff --cached --quiet; then
  echo "Image pool unchanged, nothing to commit."
  exit 0
fi

git diff --cached --stat | tail -n 1
git commit -m "Refresh home page image pool"

printf "Push to origin now? [y/N] "
read -r answer
case "$answer" in
  y|Y) git push ;;
  *) echo "Not pushed. Run 'git push' when ready." ;;
esac
