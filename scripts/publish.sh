#!/usr/bin/env bash
# Publish every crate to crates.io in dependency order, then build the
# Python wheel for PyPI. Requires: cargo login (crates.io token) and
# maturin for the wheel.
#
# crates.io publish order matters: every crate's internal dependencies
# must already be on crates.io when its turn comes.
set -euo pipefail
cd "$(dirname "$0")/.."

# Dependency order: every crate's internal dependencies must already
# be on crates.io when its turn comes. (pdfloom-def deliberately builds
# against pdfloom with default-features = false so the browser engine
# does not pull the embedded fonts; the CLI re-enables them.)
CRATES=(
    pdfloom-core
    pdfloom-parse
    pdfloom-font
    pdfloom-fonts
    pdfloom-fonts-data
    pdfloom-canvas
    pdfloom-profile
    pdfloom-validate
    pdfloom-revision
    pdfloom-render
    pdfloom
    pdfloom-def
    pdfloom-draw
    pdfloom-api
    pdfloom-cli
    pdfloom-server
)

if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=1
    echo "== dry run: crates.io upload rehearsal =="
else
    DRY_RUN=0
    if ! cargo whoami >/dev/null 2>&1; then
        echo "Not logged in to crates.io. Run: cargo login <token>" >&2
        exit 2
    fi
fi

for c in "${CRATES[@]}"; do
    echo "== $c =="
    # --allow-dirty: the workspace is one tree; sibling crates are not
    # "dirty" after the first publishes.
    if [ "$DRY_RUN" = "1" ]; then
        # A dry run uploads nothing, so any crate whose internal deps
        # are not on crates.io yet cannot resolve them - the real run
        # publishes in dependency order, so by each crate's turn its
        # deps are already on the index. Treat exactly that expected
        # error as a pass for this crate; anything else is a failure.
        # Leaf crates (no internal deps) get the full verification
        # build this way.
        if ! out=$(cargo publish -p "$c" --allow-dirty --dry-run 2>&1); then
            if printf '%s' "$out" | grep -q "no matching package named \`pdfloom"; then
                echo "   packs once its deps publish (order above covers it)"
            else
                printf '%s\n' "$out" >&2
                exit 1
            fi
        fi
    else
        cargo publish -p "$c" --allow-dirty
    fi
done

echo "== Python wheel (PyPI) =="
maturin build -r -m crates/pdfloom-py/Cargo.toml -o bindings/python/dist

echo
echo "Done. To upload the wheel:  twine upload bindings/python/dist/*.whl"
echo "(API crates pdfloom-py/pdfloom-uniffi/pdfloom-ffi publish per-platform separately.)"
