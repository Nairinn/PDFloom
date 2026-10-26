// Native <-> WASM parity gate. For EVERY fixture under tests/parity/
// the same input builds through native code (pdfloom-cli /
// pdfloom-parity-runner) and through the WASM engine in Node
// (wasm-pack --target nodejs), and the outputs must be byte-identical.
// The WASM outputs land in tests/output/ so the veraPDF gate validates
// them like every other fixture.
//
// Fixtures:
//   tests/parity/configs/*.json   pdfloom-doc builds (shaping, bidi,
//                                 forms, artifacts, images, CJK, ...)
//   tests/parity/stream/*.json    streaming-writer event envelopes
//   retag                          deterministic untagged input, rebuilt
//                                 by TagSession on both sides
//
// Skips come from tests/parity/skip.txt (name | reason, reviewed; the
// harness fails on stale entries). CJK runs only when its optional
// fonts are fetched, and the skip is logged, never silent.
//
// On a byte mismatch the output names the fixture, the first
// differing byte offset, and the PDF object containing it, plus a
// 16-byte hexdump of both sides.
//
// Usage: node scripts/wasm-parity.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const pkg = await import("../crates/pdfloom-wasm/pkg-nodejs/pdfloom.js")
  .catch(() => {
    console.error("error: crates/pdfloom-wasm/pkg-nodejs is missing;");
    console.error("  build it first: wasm-pack build crates/pdfloom-wasm \\");
    console.error("      --target nodejs --out-dir pkg-nodejs --out-name pdfloom");
    process.exit(2);
  });

const OUT = root + "tests/output";
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- helpers

const catalog = JSON.parse(pkg.catalog());

function fontBytes(family, style) {
  const entry =
    catalog.find((e) => e.family === family && e.style === style) ||
    catalog.find((e) => e.family === family && e.style === "Regular");
  if (!entry) throw new Error(`font not in catalog: ${family}|${style}`);
  const p = root + "fonts/" + entry.file;
  if (!existsSync(p)) return null; // e.g. CJK not fetched
  return new Uint8Array(readFileSync(p));
}

function bundleFor(defObj) {
  const wanted = new Map();
  const want = (family, style) => {
    if (family) wanted.set(family + "|" + style, [family, style]);
  };
  for (const page of defObj.pages || []) {
    for (const e of page.elements || []) if (e.font) want(e.font.family, e.font.style);
  }
  want("Liberation Sans", "Regular"); // engine default face
  const bundle = new pkg.FontBundle();
  for (const [family, style] of wanted.values()) {
    const bytes = fontBytes(family, style);
    if (bytes) bundle.add(family, style, bytes);
  }
  return bundle;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function objectAt(bytes, off) {
  // Scan backward for the "N M obj" header that encloses the offset.
  const s = Buffer.from(bytes.subarray(0, off)).toString("latin1");
  const m = [...s.matchAll(/(\d+) (\d+) obj/g)];
  if (!m.length) return "(before the first object)";
  return `object ${m[m.length - 1][1]} ${m[m.length - 1][2]} obj`;
}

function hexdump(bytes, off) {
  const from = Math.max(0, off - 8);
  const to = Math.min(bytes.length, off + 9);
  const slice = [...bytes.subarray(from, to)]
    .map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return `bytes [${from}..${to - 1}]: ${slice}  (differing byte at ${off} = 0x${bytes[off].toString(16).padStart(2, "0")})`;
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: ["ignore", "inherit", "inherit"] });
}

let passed = 0, skipped = 0;
const skipReasons = [];
const failures = [];

function skip(name, reason) {
  skipped++;
  skipReasons.push(`${name}: ${reason}`);
  console.log(`SKIP ${name} - ${reason}`);
}

function compare(name, wasmBytes, nativeBytes) {
  const off = firstDiff(wasmBytes, nativeBytes);
  if (off === -1) {
    passed++;
    console.log(`PASS ${name} (${wasmBytes.length} bytes, identical)`);
    return true;
  }
  failures.push(name);
  console.error(`FAIL ${name}`);
  console.error(`  first differing byte offset: ${off} (0x${off.toString(16)})`);
  console.error(`  containing PDF object: ${objectAt(wasmBytes, off)}`);
  console.error(`  wasm:   ${hexdump(wasmBytes, off)}`);
  console.error(`  native: ${hexdump(nativeBytes, off)}`);
  return false;
}

// ------------------------------------------------------------- skip list

const permanentSkips = new Map(); // name -> reason
for (const line of readFileSync(root + "tests/parity/skip.txt", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const [name, ...rest] = t.split("|");
  permanentSkips.set(name.trim(), rest.join("|").trim() || "listed in skip.txt");
}

// ---------------------------------------------------------------- config

const { readdirSync } = await import("node:fs");
const configNames = readdirSync(root + "tests/parity/configs")
  .filter((f) => f.endsWith(".json"));

for (const file of configNames) {
  const name = "config:" + file.replace(/\.json$/, "");
  if (permanentSkips.has(name)) { skip(name, permanentSkips.get(name)); permanentSkips.delete(name); continue; }
  const cfgPath = root + "tests/parity/configs/" + file;
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));

  // CJK fixtures need the optional fetched faces.
  const families = new Set();
  for (const p of cfg.pages) for (const e of p.elements) if (e.font) families.add(e.font.family);
  const needsCjk = [...families].some((f) => /cjk/i.test(f));
  if (needsCjk && !existsSync(root + "fonts/vendor/noto/NotoSansCJKjp-Regular.otf")) {
    skip(name, "Noto Sans CJK JP not fetched (run scripts/fetch-cjk-fonts.sh)");
    continue;
  }

  const bundle = bundleFor(cfg);
  const out = pkg.build(readFileSync(cfgPath, "utf8"), bundle);
  const wasmBytes = Buffer.from(out.pdf);
  const report = JSON.parse(out.report);
  if (report.status !== "compliant") {
    failures.push(name);
    console.error(`FAIL ${name}: build not compliant: ${JSON.stringify(report.violations)}`);
    continue;
  }

  const nativePath = `${OUT}/parity_${name.replace("config:", "")}_native.pdf`;
  run("cargo", ["run", "-p", "pdfloom-cli", "--", "build", cfgPath, "--out", nativePath]);
  const nativeBytes = readFileSync(nativePath);

  if (compare(name, wasmBytes, nativeBytes)) {
    writeFileSync(`${OUT}/parity_${name.replace("config:", "")}.pdf`, wasmBytes);
  }
}

// ---------------------------------------------------------------- stream

const streamNames = readdirSync(root + "tests/parity/stream").filter((f) => f.endsWith(".json"));
for (const file of streamNames) {
  const name = "stream:" + file.replace(/\.json$/, "");
  if (permanentSkips.has(name)) { skip(name, permanentSkips.get(name)); permanentSkips.delete(name); continue; }
  const envPath = root + "tests/parity/stream/" + file;
  const envelope = readFileSync(envPath, "utf8");

  const bundle = bundleFor({ pages: [] });
  const out = pkg.build_stream(envelope, bundle);
  const wasmBytes = Buffer.from(out.pdf);
  const report = JSON.parse(out.report);
  if (report.status !== "compliant") {
    failures.push(name);
    console.error(`FAIL ${name}: stream build not compliant`);
    continue;
  }

  const nativePath = `${OUT}/parity_${name.replace("stream:", "stream_")}_native.pdf`;
  run("cargo", ["run", "-p", "pdfloom-parity-runner", "--", "stream", envPath, "--out", nativePath]);
  const nativeBytes = readFileSync(nativePath);

  if (compare(name, wasmBytes, nativeBytes)) {
    writeFileSync(`${OUT}/parity_${name.replace("stream:", "stream_")}.pdf`, wasmBytes);
  }
}

// ----------------------------------------------------------------- retag

{
  const name = "retag:untagged-input";
  if (permanentSkips.has(name)) { skip(name, permanentSkips.get(name)); permanentSkips.delete(name); }

  // The input is deliberately untagged/minimal: keep it OUT of
  // tests/output so the veraPDF gate never sees it (it validates
  // outputs only, like the native untagged.pdf inputs).
  const inputPath = (await import("node:os")).tmpdir() + "/parity_retag_input.pdf";
  run("cargo", ["run", "-p", "pdfloom-parity-runner", "--", "make-untagged", "--out", inputPath]);
  const input = readFileSync(inputPath);

  const nativePath = OUT + "/parity_retag_native.pdf";
  run("cargo", ["run", "-p", "pdfloom-parity-runner", "--", "retag", inputPath,
    "--out", nativePath, "--title", "Retag parity", "--lang", "en-US", "--profile", "ua1"]);

  const bundle = bundleFor({ pages: [] });
  const out = pkg.retag(new Uint8Array(input), bundle, "Retag parity", "en-US", "ua1");
  const wasmBytes = Buffer.from(out.pdf);
  const nativeBytes = readFileSync(nativePath);
  if (compare(name, wasmBytes, nativeBytes)) {
    writeFileSync(OUT + "/parity_retag.pdf", wasmBytes);
  }
}

// -------------------------------------------------------------- stale skip

if (permanentSkips.size) {
  console.error("STALE SKIP ENTRIES in tests/parity/skip.txt (fixture no longer exists):");
  for (const [n] of permanentSkips) console.error("  " + n);
  process.exit(1);
}

// ---------------------------------------------------------------- summary

console.log("----");
console.log(`parity: ${passed} pass, ${skipped} skip, ${failures.length} fail`);
for (const r of skipReasons) console.log("  skip reason: " + r);
if (failures.length) process.exit(1);
