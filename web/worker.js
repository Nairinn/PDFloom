/* PDFloom Studio's build worker: hosts the WASM pdfloom engine so
 * builds, validation, retagging and page rendering never block the
 * editor UI. Fonts are lazy-fetched from /fonts/ exactly like the
 * deployed static layout; the two optional CJK faces may be absent and
 * are simply skipped when a fetch 404s.
 *
 * Protocol: {id, op, ...} in; {id, ok, result|error} out. "ready" is
 * sent once the wasm module is instantiated.
 */

import init, * as pdfloom from "/engine/pdfloom.js";

const FONTS_BASE = "/fonts/";
const fontCache = new Map();   // "family|style" -> Uint8Array | null (404)
let catalog = null;

async function ensureInit() {
  if (!ensureInit._p) ensureInit._p = init();
  return ensureInit._p;
}

function reply(id, ok, result) {
  self.postMessage(ok ? { id, ok: true, result } : { id, ok: false, error: String(result) });
}

/* Collect every (family, style) a config references, plus the default
 * face the engine always wants registered. */
function fontsWanted(def) {
  const want = new Map(); // key -> [family, style]
  const add = (family, style) => {
    const key = family + "|" + style;
    if (!want.has(key)) want.set(key, [family, style]);
  };
  for (const page of def.pages || []) {
    for (const e of page.elements || []) {
      if (e.font) add(e.font.family || "Liberation Sans", e.font.style || "Regular");
    }
  }
  add("Liberation Sans", "Regular"); // engine default
  return want;
}

async function fetchFont(family, style) {
  const key = family + "|" + style;
  if (fontCache.has(key)) return fontCache.get(key);
  let bytes = null;
  if (!catalog) catalog = JSON.parse(pdfloom.catalog());
  const entry = catalog.find((c) => c.family === family && c.style === style);
  if (entry) {
    try {
      const res = await fetch(FONTS_BASE + entry.file);
      if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
    } catch { /* absent face (e.g. CJK not deployed): skip */ }
  }
  fontCache.set(key, bytes);
  return bytes;
}

async function bundleFor(def) {
  const bundle = new pdfloom.FontBundle();
  for (const [, [family, style]] of fontsWanted(def)) {
    const bytes = await fetchFont(family, style);
    if (bytes) bundle.add(family, style, bytes);
  }
  return bundle;
}

self.onmessage = async (ev) => {
  const { id, op } = ev.data || {};
  try {
    await ensureInit();
    switch (op) {
      case "build": {
        const def = JSON.parse(ev.data.config);
        const bundle = await bundleFor(def);
        const out = pdfloom.build(ev.data.config, bundle);
        reply(id, true, { pdf: out.pdf, report: JSON.parse(out.report) });
        break;
      }
      case "retag": {
        const def = { pages: [] };
        const bundle = await bundleFor(def);
        const out = pdfloom.retag(
          new Uint8Array(ev.data.bytes), bundle,
          ev.data.title, ev.data.lang, ev.data.profile);
        reply(id, true, { pdf: out.pdf, report: JSON.parse(out.report) });
        break;
      }
      case "validate": {
        const report = pdfloom.validate(new Uint8Array(ev.data.bytes));
        reply(id, true, JSON.parse(report));
        break;
      }
      case "render": {
        const png = pdfloom.render_page(
          new Uint8Array(ev.data.bytes), ev.data.page, ev.data.dpi);
        reply(id, true, png);
        break;
      }
      default:
        reply(id, false, "unknown op " + op);
    }
  } catch (e) {
    reply(id, false, e && e.message ? e.message : String(e));
  }
};

// Signal readiness once the module can actually instantiate.
(async () => {
  try {
    await ensureInit();
    self.postMessage({ id: "ready", ok: true, result: pdfloom.version() });
  } catch (e) {
    self.postMessage({ id: "ready-failed", ok: false, error: String(e) });
  }
})();
