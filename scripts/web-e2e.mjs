// Headless verification of the built Studio (Playwright, real browser):
// 1. Load the editor, run #selftest, require 0 failures.
// 2. Build a sample doc through the UI and assert the compliance
//    badge turns green and the PDF downloads.
// 3. Drop that PDF back onto the page: retag runs locally.
//
// Requires playwright in node_modules (CI: `npm install playwright`;
// locally any directory works via PLAYWRIGHT_DIR).
// Usage: node scripts/web-e2e.mjs <base-url>
//        (default http://localhost:8912 served from web/dist)

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const dir = process.env.PLAYWRIGHT_DIR || "/tmp/pwtest";
  ({ chromium } = await import(dir + "/node_modules/playwright/index.mjs"));
}

const BASE = process.argv[2] || "http://localhost:8912";

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

let failures = 0;
const fail = (msg) => { failures++; console.error("FAIL " + msg); };
const pass = (msg) => console.log("PASS " + msg);

// 1. Selftest through the real UI.
await page.goto(BASE + "/#selftest", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const pre = document.querySelector("#selftest-results");
  return pre && pre.textContent.includes("SELFTEST DONE");
}, { timeout: 120_000 });
const results = await page.textContent("#selftest-results");
process.stdout.write(results.split("\n").filter((l) => l.trim()).map((l) => "  " + l).join("\n") + "\n");
if (/\bFAIL\b/.test(results)) fail("selftest reported failures");
else pass("selftest: 0 failures");
if (!results.includes("wasm engine builds a PDF")) {
  fail("selftest did not run through the wasm engine (engine fallback?)");
} else {
  pass("build went through the in-browser wasm engine");
}

// 2. Fresh session: build a sample doc via the UI.
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
const pageErrors2 = [];
page2.on("pageerror", (e) => pageErrors2.push(e.message));
await page2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page2.click('[data-add="heading"]');
await page2.click('[data-add="paragraph"]');
const downloadPromise = page2.waitForEvent("download", { timeout: 60_000 });
await page2.click("#export-pdf");
const download = await downloadPromise;
const path = "/tmp/studio-e2e-download.pdf";
await download.saveAs(path);
const bytes = await import("node:fs").then((fs) => fs.readFileSync(path));
if (bytes.subarray(0, 5).toString() === "%PDF-") pass(`download is a PDF (${bytes.length} bytes)`);
else fail("download is not a PDF");
await page2.waitForFunction(() => {
  const b = document.querySelector("#compliance-badge");
  return b && b.textContent.includes("compliant");
}, { timeout: 30_000 });
const badge = await page2.textContent("#compliance-badge");
if (badge.includes("PDF/UA compliant")) pass("compliance badge is green: " + badge.trim());
else fail("compliance badge: " + badge);

// 3. Drag-and-drop retag: drop the PDF we just downloaded.
const fs = await import("node:fs");
const dropB64 = fs.readFileSync(path).toString("base64");
const dtHandle = await page2.evaluateHandle((b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "sample.pdf", { type: "application/pdf" }));
  return dt;
}, dropB64);
await page2.dispatchEvent("#canvas-wrap", "drop", { dataTransfer: dtHandle });
await page2.waitForFunction(() => {
  const t = document.querySelector("#status-text");
  return t && /retagged/i.test(t.textContent);
}, { timeout: 60_000 });
const status = await page2.textContent("#status-text");
if (/retagged/i.test(status)) pass("drop -> retag ran locally: " + status.trim().slice(0, 90));
else fail("drop -> retag did not complete");

const jsErrors = [...logs, ...pageErrors2].filter((l) => l.includes("pageerror") || l.includes("console:error"));
if (jsErrors.length) {
  console.error("  page errors observed:");
  for (const l of jsErrors.slice(0, 10)) console.error("   " + l);
  fail("page errors during the run");
} else pass("no page errors");

await browser.close();
if (failures) process.exit(1);
console.log("E2E OK");
