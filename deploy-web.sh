#!/usr/bin/env bash
# Atomic web deploy: assets first, index.html LAST, never delete before upload.
# (A killed transfer must leave the previous site working, not a blank page.)
set -euo pipefail
cd "$(dirname "$0")/web"
npm run build
HOST=root@206.237.18.80
DOCROOT=/var/www/heirloom
scp -qr dist/assets "$HOST:$DOCROOT/assets.new"
scp -q dist/*.svg "$HOST:$DOCROOT/" 2>/dev/null || true
ssh "$HOST" "cp -r $DOCROOT/assets.new/. $DOCROOT/assets/ 2>/dev/null || mv $DOCROOT/assets.new $DOCROOT/assets; rm -rf $DOCROOT/assets.new"
scp -q dist/index.html "$HOST:$DOCROOT/index.html"   # the switch — old bundle stays valid until this lands
ssh "$HOST" "cd $DOCROOT/assets && ls -t index-*.js 2>/dev/null | tail -n +6 | xargs -r rm -f"  # keep last 5 bundles
REF=$(grep -oE '/assets/index-[^"]+\.js' web/../web/dist/index.html 2>/dev/null || grep -oE '/assets/index-[^"]+\.js' dist/index.html)
L=$(stat -f%z "dist$REF" 2>/dev/null || stat -c%s "dist$REF")
R=$(curl -s --noproxy '*' "https://heirloom.axiqo.xyz$REF" | wc -c | tr -d ' ')
echo "verify $REF local=$L remote=$R"
[ "$L" = "$R" ] && echo "DEPLOY OK" || { echo "SIZE MISMATCH — investigate"; exit 1; }
