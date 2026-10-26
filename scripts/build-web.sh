#!/usr/bin/env bash
# Build the deployable static site (web/dist) for Cloudflare Workers:
#
#   - the WASM engine (wasm-pack --target web),
#   - the Studio sources,
#   - the bundled OFL fonts (the two optional Noto CJK faces excluded,
#     like the native fetch script).
#
# Cacheable assets live under content-hashed directories so _headers can
# mark them immutable:
#
#   dist/index.html                     no-cache shell
#   dist/assets/<hash>/...              app + engine + wasm, immutable
#   dist/fonts/<hash>/vendor/...         OFL fonts, immutable
#
# The script fails with a clear message if the output exceeds the
# Workers static-asset limits (20,000 files, 25 MiB per file, 100
# _headers rules, 2,000 chars per line) or if any required input is
# missing.
#
# Usage:
#   scripts/build-web.sh            build web/dist (deployable)
#   scripts/build-web.sh --dev      build only web/engine/ for the local
#                                   cargo run -p pdfloom-server dev flow
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
DIST="$WEB/dist"
FONT_SRC="$ROOT/fonts"
PKG_TMP="$(mktemp -d)"
trap 'rm -rf "$PKG_TMP"' EXIT

# Cloudflare Workers static-asset limits (free tier; see
# developers.cloudflare.com/workers/platform/limits/#static-assets).
MAX_FILES=20000
MAX_FILE_BYTES=$((25 * 1024 * 1024))
MAX_HEADER_RULES=100
MAX_HEADER_LINE=2000

command -v wasm-pack >/dev/null || { echo "error: wasm-pack not found (brew install wasm-pack)" >&2; exit 2; }
[ -x "$ROOT/target/debug/pdfloom-server" ] || [ -d "$ROOT/target/release" ] || true
for f in "$WEB/index.html" "$WEB/app.js" "$WEB/engine.js" "$WEB/worker.js" "$WEB/styles.css"; do
  [ -f "$f" ] || { echo "error: missing $f" >&2; exit 2; }
done

hash_of() { # hash_of file...
  if command -v sha256sum >/dev/null; then
    cat "$@" | sha256sum | cut -c1-16
  else
    cat "$@" | shasum -a 256 | cut -c1-16
  fi
}
size_of() { wc -c < "$1" | tr -d ' '; }

# -------------------------------------------------------------- dev engine
if [ "${1:-}" = "--dev" ]; then
  echo "== dev engine (web/engine for cargo run -p pdfloom-server) =="
  wasm-pack build "$ROOT/crates/pdfloom-wasm" --target web \
    --out-dir "$WEB/engine" --out-name pdfloom
  echo "dev engine ready: web/engine/pdfloom_bg.wasm"
  exit 0
fi

# ------------------------------------------------------------- full deploy
echo "== building WASM engine (release) =="
wasm-pack build "$ROOT/crates/pdfloom-wasm" --release --target web \
  --out-dir "$PKG_TMP" --out-name pdfloom

rm -rf "$DIST"
mkdir -p "$DIST"

# Content hash over the deployable app+engine unit: one hash covers the
# bundle that always ships together.
echo "== hashing assets =="
AHASH="$(hash_of "$WEB/app.js" "$WEB/engine.js" "$WEB/worker.js" "$WEB/styles.css" \
                  "$PKG_TMP/pdfloom.js" "$PKG_TMP/pdfloom_bg.wasm")"

# Fonts hash over the tree manifest (name, size, per-file hash).
MANIFEST="$(cd "$FONT_SRC" && find . -type f \( -name '*.ttf' -o -name 'LICENSE' -o -name '*.txt' \) \
  ! -name 'NotoSansCJK*' -print0 | sort -z | xargs -0 shasum -a 256 2>/dev/null || true)"
FHASH="$(printf '%s' "$MANIFEST" | shasum -a 256 | cut -c1-16)"

ASSETS="$DIST/assets/$AHASH"
FONTS="$DIST/fonts/$FHASH"
mkdir -p "$ASSETS" "$FONTS"

echo "assets dir: /assets/$AHASH"
echo "fonts dir:  /fonts/$FHASH"

echo "== copying app + engine =="
cp "$WEB/app.js" "$WEB/styles.css" "$ASSETS/"
# engine.js: point the worker URL at the hashed assets dir.
sed 's|const WORKER_URL = "/worker.js";|const WORKER_URL = "/assets/'"$AHASH"'/worker.js";|' \
  "$WEB/engine.js" > "$ASSETS/engine.js"
cp "$PKG_TMP/pdfloom.js" "$PKG_TMP/pdfloom_bg.wasm" "$ASSETS/"

# worker.js: same directory as the wasm module in the dist layout.
sed 's|"/engine/pdfloom.js"|"./pdfloom.js"|; s|"/fonts/"|"/fonts/'"$FHASH"'/"|' \
  "$WEB/worker.js" > "$ASSETS/worker.js"

echo "== copying fonts (CJK included when fetched) =="
(cd "$FONT_SRC" && find . -type f \
   \( -name '*.ttf' -o -name '*.otf' -o -name 'LICENSE' -o -name 'LICENSE-*' \) \
   -print0) |
while IFS= read -r -d '' f; do
  mkdir -p "$FONTS/$(dirname "$f")"
  cp "$FONT_SRC/$f" "$FONTS/$f"
done

# The fonts manifest: every deployed face with its SHA-256 and hashed
# URL. `pdfloom fonts install cjk --base <site>` reads it to download
# the CJK faces from this deploy (hash-checked against the compiled-in
# values either way).
echo "== writing fonts-manifest.json =="
MANIFEST="$DIST/fonts-manifest.json"
printf '[' > "$MANIFEST"
first=1
while IFS= read -r -d '' f; do
  rel="${f#./}"
  sha="$(shasum -a 256 "$FONTS/$rel" | cut -d' ' -f1)"
  size="$(size_of "$FONTS/$rel")"
  [ "$size" -le "$MAX_FILE_BYTES" ] \
    || { echo "error: font $rel is $size bytes (over the 25 MiB asset limit)" >&2; exit 1; }
  [ "$first" -eq 0 ] && printf ',' >> "$MANIFEST"
  first=0
  printf '{\"file\":\"%s\",\"sha256\":\"%s\",\"url\":\"/fonts/%s/%s\"}' \
    "$rel" "$sha" "$FHASH" "$rel" >> "$MANIFEST"
done < <(cd "$FONTS" && find . -type f \( -name '*.ttf' -o -name '*.otf' \) -print0 | sort -z)
printf ']' >> "$MANIFEST"

echo "== writing index.html shell =="
sed -e 's|"/styles.css"|"/assets/'"$AHASH"'/styles.css"|' \
    -e 's|"/engine.js"|"/assets/'"$AHASH"'/engine.js"|' \
    -e 's|"/app.js"|"/assets/'"$AHASH"'/app.js"|' \
    "$WEB/index.html" > "$DIST/index.html"

echo "== writing _headers =="
cat > "$DIST/_headers" <<HEADERS
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*.wasm
  Content-Type: application/wasm

/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache
HEADERS

# ------------------------------------------------------------- limit gates
echo "== checking Workers static-asset limits =="
FILES=$(find "$DIST" -type f | wc -l | tr -d ' ')
[ "$FILES" -le "$MAX_FILES" ] \
  || { echo "error: $FILES files exceeds the Workers limit of $MAX_FILES" >&2; exit 1; }

BAD=$(find "$DIST" -type f -size +"$MAX_FILE_BYTES"c)
[ -z "$BAD" ] || { echo "error: file(s) over 25 MiB: $BAD" >&2; exit 1; }

RULES=$(grep -cE '^/' "$DIST/_headers")
LONGLINE=$(awk '{ if (length($0) > '"$MAX_HEADER_LINE"') print NR }' "$DIST/_headers")
[ "$RULES" -le "$MAX_HEADER_RULES" ] || { echo "error: _headers has $RULES rules (limit $MAX_HEADER_RULES)" >&2; exit 1; }
[ -z "$LONGLINE" ] || { echo "error: _headers line(s) too long: $LONGLINE" >&2; exit 1; }

echo "files: $FILES (limit $MAX_FILES)"

# ------------------------------------------------------------- size report
WASM="$ASSETS/pdfloom_bg.wasm"
RAW=$(size_of "$WASM")
GZ=$(gzip -9 -c "$WASM" | wc -c | tr -d ' ')
BR="(brotli unavailable)"
if command -v brotli >/dev/null; then
  BR=$(brotli -q 11 -c "$WASM" | wc -c | tr -d ' ')
fi
echo "== wasm size =="
echo "pdfloom_bg.wasm: $RAW bytes raw, $GZ gzip, $BR brotli"

echo "dist ready: web/dist ($FILES files)"
