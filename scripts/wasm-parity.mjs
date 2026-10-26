// WASM/native parity gate: the same pdfloom-doc config must build to
// byte-identical PDFs through the native CLI and through the WASM
// engine in Node. Fonts are registered as in-memory bytes exactly like
// the browser does.
//
// Usage:  node scripts/wasm-parity.mjs
//
// Steps:
//   1. Rewrite the golden fixture's filesystem image path into a
//      data: URL (the browser world has no filesystem).
//   2. Build the same config natively (pdfloom CLI) and in WASM.
//   3. Byte-compare the two outputs.
//   4. Run the WASM build through the Matterhorn validator (WASM) and
//      write the output to tests/output/ for the veraPDF gate.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;

const pkg = require("../crates/pdfloom-wasm/pkg-nodejs/pdfloom.js");
const golden = JSON.parse(
  readFileSync(new URL("../crates/pdfloom-def/tests/fixtures/golden_doc.json", import.meta.url), "utf8"),
);

// 1. Browser-compatible config: embed the fixture image as a data: URL.
const pngBytes = readFileSync(
  new URL("../tests/fixtures/red_box.png", import.meta.url),
);
for (const page of golden.pages) {
  for (const el of page.elements) {
    if (el.type === "image" && el.src && !el.src.startsWith("data:")) {
      el.src = "data:image/png;base64," + pngBytes.toString("base64");
    }
  }
}
const browserConfig = JSON.stringify(golden, null, 2);
mkdirSync(new URL("../tests/output", import.meta.url), { recursive: true });
const configPath = root + "tests/output/wasm_golden.json";
writeFileSync(configPath, browserConfig);

// 2a. Native build through the CLI.
const nativeOut = root + "tests/output/wasm_golden_native.pdf";
execFileSync("cargo", [
  "run", "-p", "pdfloom-cli", "--", "build", configPath, "--out", nativeOut,
], { cwd: root, stdio: "inherit" });

// 2b. WASM build with the fonts registered from bytes (browser-style).
const catalog = JSON.parse(pkg.catalog());
const fonts = new Set();
for (const page of golden.pages) {
  for (const el of page.elements) {
    if (el.font) fonts.add(el.font.family + "|" + el.font.style);
  }
}
const bundle = new pkg.FontBundle();
for (const key of fonts) {
  const [family, style] = key.split("|");
  const entry = catalog.find(
    (e) => e.family === family && e.style === style,
  );
  if (!entry) {
    console.error("FAIL font not in catalog: " + key);
    process.exit(1);
  }
  const bytes = readFileSync(root + "fonts/" + entry.file);
  bundle.add(family, style, new Uint8Array(bytes));
}
// The engine always wants the default face available.
const defEntry = catalog.find(
  (e) => e.family === "Liberation Sans" && e.style === "Regular",
);
bundle.add("Liberation Sans", "Regular", new Uint8Array(readFileSync(root + "fonts/" + defEntry.file)));

const out = pkg.build(browserConfig, bundle);
const wasmBytes = Buffer.from(out.pdf);
const wasmOut = root + "tests/output/wasm_golden.pdf";
writeFileSync(wasmOut, wasmBytes);

const nativeBytes = readFileSync(nativeOut);

// 3. Byte-identity gate.
if (Buffer.compare(nativeBytes, wasmBytes) !== 0) {
  console.error(
    `FAIL native (${nativeBytes.length} B) != wasm (${wasmBytes.length} B)`,
  );
  process.exit(1);
}
console.log(`PASS byte-identical: ${wasmBytes.length} bytes`);

// 4. Matterhorn validation through the WASM engine too.
const report = JSON.parse(pkg.validate(wasmBytes));
if (report.findings.length !== 0) {
  console.error("FAIL wasm validator found: " + JSON.stringify(report.findings));
  process.exit(1);
}
console.log("PASS wasm validate: 0 findings");

const save = JSON.parse(out.report);
if (save.status !== "compliant") {
  console.error("FAIL wasm save report: " + JSON.stringify(save));
  process.exit(1);
}
console.log("PASS wasm build report: compliant as " + save.profile_name);

// 5. version() sanity.
console.log("engine version: " + pkg.version());
