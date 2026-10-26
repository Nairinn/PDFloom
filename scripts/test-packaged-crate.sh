#!/usr/bin/env bash
# Packaged-install verification: prove the crates.io story works.
#
#  1. pdfloom-fonts-data is the artifact where packaging can silently
#     break (the embedded fonts must physically be inside the .crate):
#     package it for real, assert the fonts are in the archive, and
#     build the extracted .crate standalone.
#  2. The full library builds OUTSIDE this repo from a sandbox copy of
#     the sources — no PDFLOOM_FONTS_DIR, no repo fonts in reach —
#     and a clean temp project (patched to the sandbox, never inside a
#     pdfloom workspace) builds a Myanmar + Arabic + Thai document.
#     The embedded tier must serve every face: the report must be
#     compliant with ZERO substitution notes, and veraPDF must pass.
#
#  Cargo cannot `cargo package` a crate whose workspace path-deps are
#  unpublished (it resolves packages against the registry by design),
#  so only the leaf crates can produce .crates today; the rest are
#  publishable in dependency order and their real dry-runs unlock as
#  each lands (scripts/publish.sh documents the order).
#
# Usage: scripts/test-packaged-crate.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d /tmp/pdfloom-packaged-XXXXXX)"
echo "WORK kept: $WORK"

echo "== 1. fonts-data .crate: package, inspect, build standalone =="
cargo package -p pdfloom-fonts-data --allow-dirty -q
CRATE="$ROOT/target/package/pdfloom-fonts-data-0.1.0.crate"
n_fonts=$(tar tzf "$CRATE" | grep -cE '\.ttf|\.otf')
n_lic=$(tar tzf "$CRATE" | grep -c "LICENSE")
[ "$n_fonts" -ge 30 ] || { echo "FAIL: .crate carries only $n_fonts faces" >&2; exit 1; }
[ "$n_lic" -ge 4 ] || { echo "FAIL: .crate carries only $n_lic license files" >&2; exit 1; }
echo "  .crate carries $n_fonts faces + $n_lic OFL license files"
mkdir -p "$WORK/crate"
tar xzf "$CRATE" -C "$WORK/crate" --strip-components=1
(cd "$WORK/crate" && cargo build -q)
echo "  extracted .crate builds standalone"

echo "== 2. sandbox library + clean consumer project =="
mkdir -p "$WORK/sandbox"
cp -R "$ROOT/crates" "$WORK/sandbox/crates"
# The copied fonts-data still points at the repo through its relative
# symlinks; resolve them into real files so the sandbox is standalone.
rm -rf "$WORK/sandbox/crates/pdfloom-fonts-data"
cp -RL "$ROOT/crates/pdfloom-fonts-data" "$WORK/sandbox/crates/pdfloom-fonts-data"
cp "$ROOT/Cargo.toml" "$WORK/sandbox/Cargo.toml"
( cd "$WORK/sandbox" && cargo build -q -p pdfloom )
echo "  sandbox library builds outside the repo"

mkdir -p "$WORK/project/src"
cat > "$WORK/project/Cargo.toml" <<EOF
[package]
name = "packaged-smoke"
version = "0.1.0"
edition = "2021"

[dependencies]
pdfloom = "0.1.0"

[patch.crates-io]
pdfloom = { path = "$WORK/sandbox/crates/pdfloom" }
pdfloom-core = { path = "$WORK/sandbox/crates/pdfloom-core" }
pdfloom-parse = { path = "$WORK/sandbox/crates/pdfloom-parse" }
pdfloom-font = { path = "$WORK/sandbox/crates/pdfloom-font" }
pdfloom-fonts = { path = "$WORK/sandbox/crates/pdfloom-fonts" }
pdfloom-fonts-data = { path = "$WORK/sandbox/crates/pdfloom-fonts-data" }
pdfloom-canvas = { path = "$WORK/sandbox/crates/pdfloom-canvas" }
pdfloom-profile = { path = "$WORK/sandbox/crates/pdfloom-profile" }
EOF
cat > "$WORK/project/src/main.rs" <<'EOF'
// What a `cargo add pdfloom` user writes: no font setup, no env vars,
// just family names. Every face must come from the embedded
// bundled-fonts tier, so the report must be compliant with ZERO
// substitution notes.
fn main() {
    let mut doc = pdfloom::Document::new(pdfloom::Profile::PdfUa1);
    doc.title("Packaged smoke").lang("en-US");
    let mm = doc.font("Noto Sans Myanmar", "Regular").expect("myanmar");
    let ar = doc.font("Noto Sans Arabic", "Regular").expect("arabic");
    let th = doc.font("Noto Sans Thai", "Regular").expect("thai");
    let mut flow = doc.flow();
    flow.heading(1, "Embedded fonts smoke test").unwrap();
    flow.paragraph_in(mm, 14.0, "\u{1000}\u{1004}\u{103A}\u{1002}\u{100B}\u{102C}\u{1015}\u{103C}\u{1000} \u{1019}\u{103C}\u{1014}\u{103A}\u{1019}\u{103C}\u{1000}").unwrap();
    flow.paragraph_in(ar, 14.0, "\u{0627}\u{0644}\u{0633}\u{0644}\u{0627}\u{0645} \u{0645}\u{0631}\u{062D}\u{0628}\u{0627} 2026").unwrap();
    flow.paragraph_in(th, 14.0, "\u{0E2A}\u{0E27}\u{0E31}\u{0E2A}\u{0E14}\u{0E35} \u{0E01}\u{0E23}\u{0E38}\u{0E13}\u{0E32}\u{0E40}\u{0E02}\u{0E49}\u{0E32}\u{0E2A}\u{0E39}\u{0E48}\u{0E23}\u{0E30}\u{0E1A}\u{0E1A}\u{0E1E}\u{0E34}\u{0E21}\u{0E1E}\u{0E4C}\u{0E20}\u{0E32}\u{0E29}\u{0E32}\u{0E44}\u{0E17}\u{0E22}").unwrap();
    drop(flow);

    let report = doc.save("packaged_smoke.pdf").expect("save");
    assert_eq!(
        report.status,
        pdfloom::Status::Compliant,
        "violations: {:#?}",
        report.violations
    );
    let substitutions: Vec<_> = report
        .human_review
        .iter()
        .filter(|n| n.contains("was not available"))
        .collect();
    assert!(
        substitutions.is_empty(),
        "substitution notes with embedded fonts: {substitutions:#?}"
    );
    println!("clean project: compliant, 0 substitution notes");
}
EOF

(cd "$WORK/project" && env -u PDFLOOM_FONTS_DIR cargo run -q --release)

OUT="$WORK/project/packaged_smoke.pdf"
[ -f "$OUT" ] || { echo "output PDF missing" >&2; exit 1; }
echo "== output: $(wc -c < "$OUT" | tr -d ' ') bytes =="

if [ -x "$ROOT/tools/verapdf/verapdf" ]; then
  echo "== veraPDF =="
  "$ROOT/tools/verapdf/verapdf" -f ua1 "$OUT" | grep -q 'failedChecks="0"' \
    || { echo "veraPDF found failed checks" >&2; exit 1; }
  echo "veraPDF: 0 failed checks"
else
  echo "(veraPDF not installed locally; CI runs the gate)"
fi
echo "PACKAGED CRATE OK"
