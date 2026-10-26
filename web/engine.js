/* PDFloom Studio engine: one transport interface, two implementations.
 *
 * WasmEngine (default) builds PDFs entirely in the browser inside a Web
 * Worker — no server involved. ServerEngine (opt in with ?server) is
 * the original HTTP path to a running pdfloom-server, kept for local
 * development.
 *
 * Interface (both engines):
 *   engine.ready: Promise<void>      resolves when the engine can build
 *   engine.build(def): Promise<{pdf: Uint8Array, report: object}>
 *   engine.retag(bytes, opts): Promise<{pdf: Uint8Array, report: object}>
 *   engine.validate(bytes): Promise<{findings: [], review: []}>
 *   engine.renderPage(bytes, page, dpi): Promise<Uint8Array>  (PNG)
 *   engine.name: "wasm" | "server"
 *
 * The report object matches the pdfloom-server /api/build wire format,
 * so the UI treats both engines identically.
 */

"use strict";

const FONT_BASE = "/fonts/";          // dev: server route; prod: static
const WORKER_URL = "/worker.js";   // source file in web/; engine assets live under /engine/

/* ------------------------------------------------------------- WasmEngine */

class WasmEngine {
  constructor() {
    this.name = "wasm";
    this._seq = 0;
    this._pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this._worker = new Worker(WORKER_URL, { type: "module" });
      this._worker.onmessage = (ev) => this._onMessage(ev, resolve, reject);
      this._worker.onerror = (e) => {
        reject(new Error("engine worker failed to load: " +
          (e.message || "is web/engine/ built? run scripts/build-web.sh")));
      };
    });
  }

  _onMessage(ev, resolveReady, rejectReady) {
    const { id, ok, result, error } = ev.data || {};
    if (id === "ready") {
      this.version = result;
      resolveReady();
      return;
    }
    if (id === "ready-failed") {
      rejectReady(new Error(error));
      return;
    }
    const p = this._pending.get(id);
    if (!p) return;
    this._pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error || "engine error"));
  }

  _call(op, payload) {
    return this.ready.then(() => new Promise((resolve, reject) => {
      const id = String(++this._seq);
      this._pending.set(id, { resolve, reject });
      this._worker.postMessage({ id, op, ...payload });
    }));
  }

  build(def) {
    return this._call("build", { config: JSON.stringify(def) });
  }

  retag(bytes, opts) {
    return this._call("retag", { bytes, title: opts.title || "Retagged document",
                                 lang: opts.lang || "en-US",
                                 profile: opts.profile || "ua1" });
  }

  validate(bytes) {
    return this._call("validate", { bytes });
  }

  renderPage(bytes, page, dpi) {
    return this._call("render", { bytes, page, dpi: dpi || 96 });
  }
}

/* ----------------------------------------------------------- ServerEngine */

class ServerEngine {
  constructor() {
    this.name = "server";
    this.ready = Promise.resolve();
  }

  async build(def) {
    const res = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ def }),
    });
    if (!res.ok) throw new Error((await res.text()).slice(0, 300));
    const data = await res.json();
    return {
      pdf: Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0)),
      report: data.report,
    };
  }

  async retag() {
    throw new Error("retag runs in the browser only (WasmEngine); " +
                    "drop a PDF without ?server");
  }

  async validate() {
    throw new Error("validate runs in the browser only (WasmEngine); " +
                    "drop a PDF without ?server");
  }

  async renderPage() {
    throw new Error("page rendering runs in the browser only (WasmEngine)");
  }
}

/* ------------------------------------------------------------------ export */

function createEngine() {
  if (new URLSearchParams(location.search).has("server")) {
    return new ServerEngine();
  }
  return new WasmEngine();
}

window.PDFloomEngine = { createEngine, WasmEngine, ServerEngine };
