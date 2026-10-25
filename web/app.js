/* PDFloom Studio: a buildless visual editor for pdfloom-doc documents.
 *
 * Figma-style dark UI. The editor state IS the pdfloom-doc config (the
 * same JSON you download), so importing a config restores the editor
 * exactly, and "Download PDF" and "pdfloom build" always agree.
 * Coordinates are stored in PDF points with a bottom-left origin; the
 * DOM renders top-left, so the converter functions below are the only
 * places that translate.
 *
 * Doc-editor behavior: click to select, drag to move, eight resize
 * handles, double-click text elements to edit them in place on the
 * canvas, arrow keys nudge (Shift = 10pt), Ctrl/Cmd+Z / Shift+Z undo
 * and redo, Ctrl/Cmd+C/X/V copy, cut and paste, Ctrl/Cmd+D duplicates,
 * Escape deselects, Ctrl/Cmd+wheel zooms toward the cursor, space (or
 * middle mouse) pans, Shift+0 zooms to fit. The inspector edits
 * position/size numerically and aligns elements to the page.
 */

"use strict";

// ---------------------------------------------------------------- state

const PAGE_SIZES = {
  "Letter portrait": [612, 792],
  "Letter landscape": [792, 612],
  "A4 portrait": [595.28, 841.89],
  "A4 landscape": [841.89, 595.28],
};

const FONT_FAMILIES = [
  "Liberation Sans", "Liberation Serif", "Liberation Mono",
  "Noto Sans", "Noto Serif", "Noto Sans Mono",
  "Noto Sans Myanmar", "Noto Sans Thai", "Noto Sans Arabic",
  "Noto Sans CJK JP", "Atkinson Hyperlegible", "OpenDyslexic",
  "Helvetica", "Times-Roman", "Courier", "Arial",
];
const FONT_STYLES = ["Regular", "Bold", "Italic", "Bold Italic"];
// Which styles actually exist per family in the bundled catalog (the
// same faces the PDF embeds). Families absent from this map ship only
// Regular + Bold. The Style dropdown offers exactly these, so every
// Family/Style combo the inspector offers can be honored by the PDF;
// the canvas, the config, and the embedded font face always agree.
// Standard-14 aliases resolve to the Liberation look-alikes, which
// have all four faces.
const CATALOG_STYLES = {
  "Liberation Sans": FONT_STYLES,
  "Liberation Serif": FONT_STYLES,
  "Liberation Mono": FONT_STYLES,
  "Noto Sans": FONT_STYLES,
  "Helvetica": FONT_STYLES,
  "Times-Roman": FONT_STYLES,
  "Courier": FONT_STYLES,
  "Arial": FONT_STYLES,
};

function stylesFor(family) {
  return CATALOG_STYLES[family] || ["Regular", "Bold"];
}

// When the family changes, keep the style valid for the new family:
// Bold Italic -> Bold (keep the weight), anything else -> Regular.
function clampStyle(family, style) {
  const offered = stylesFor(family);
  if (offered.includes(style)) return style;
  if (/Bold/.test(style) && offered.includes("Bold")) return "Bold";
  return "Regular";
}

let doc = null;          // the pdfloom-doc object (state IS the config)
let current = 0;         // current page index
let sel = null;          // selected element (live reference into doc)
let zoom = 1.0;
let showOrder = false;
let showPreview = false;
let undoStack = [];
let redoStack = [];

// UI-only state (never serialized into the config):
let editing = null;      // element being inline-edited on the canvas
let editOrig = "";        // its text when editing started
let editArea = null;      // the textarea overlay
let clipboard = null;      // serialized element for copy/paste
let spaceDown = false;    // space held = pan mode
let titleOrig = null;     // doc.title when the title input got focus
let lastNudge = 0;         // debounce: a burst of arrow keys = one undo step
const boxMap = new WeakMap(); // element -> its DOM box (this render)
let geomInputs = [];      // X/Y/W/H inputs, synced without re-render

const PAD = 48;          // canvas breathing room, must match styles.css

// ---------------------------------------------------------------- icons

const svg = (inner) =>
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" ' +
  'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";

const ICONS = {
  undo: svg('<path d="M3 8h8.5a3.5 3.5 0 1 1 0 7H6.5"/><path d="M6 5 3 8l3 3"/>'),
  redo: svg('<path d="M13 8H4.5a3.5 3.5 0 1 0 0 7h4.5"/><path d="M10 5l3 3-3 3"/>'),
  order: svg('<path d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8"/><circle cx="2.8" cy="3.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.8" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="2.8" cy="12.5" r="0.9" fill="currentColor" stroke="none"/>'),
  preview: svg('<path d="M1.5 8s2.6-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>'),
  import: svg('<path d="M8 10V2.5M4.8 5.7 8 2.5l3.2 3.2"/><path d="M2.5 10.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  config: svg('<path d="M9 2.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5L9 2.5Z"/><path d="M9 2.5V6.5H13"/>'),
  download: svg('<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.5 13.5h11"/>'),
  trash: svg('<path d="M2.5 4.5h11M6.5 4.5v-2h3v2M4 4.5l.8 9h6.4l.8-9M6.8 7.2v3.8M9.2 7.2v3.8"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  minus: svg('<path d="M3 8h10"/>'),
  refresh: svg('<path d="M13.2 8.8a5.2 5.2 0 1 1-1.4-4.6"/><path d="M12.5 2.2v3h-3"/>'),
  duplicate: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5h6.5"/>'),
  up: svg('<path d="M4.5 9.8 8 6.3l3.5 3.5"/>'),
  down: svg('<path d="M4.5 6.3 8 9.8l3.5-3.5"/>'),
  table: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 6.5h13M6.5 6.5v7M11 6.5v7"/>'),
  image: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><circle cx="5" cy="5.8" r="1.1"/><path d="M4.5 11l2.6-2.8 2 2.2 1.9-1.7 2.5 2.3"/>'),
  form_field: svg('<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M11 6v4M9 8h4"/>'),
  rect: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="0.5"/>'),
  line: svg('<path d="M2.5 12.5 13.5 3.5"/>'),
  "align-left": svg('<path d="M2 4h12M2 8h7.5M2 12h12"/>'),
  "align-ch": svg('<path d="M2 4h12M4.25 8h7.5M2 12h12"/>'),
  "align-right": svg('<path d="M2 4h12M6.5 8h7.5M2 12h12"/>'),
  "align-top": svg('<path d="M4 2v12M8 2v7.5M12 2v12"/>'),
  "align-cv": svg('<path d="M4 2v12M8 4.25v7.5M12 2v12"/>'),
  "align-bottom": svg('<path d="M4 2v12M8 6.5v7.5M12 2v12"/>'),
};

const glyph = (t) => '<span class="glyph" aria-hidden="true">' + t + "</span>";

function typeIcon(type) {
  switch (type) {
    case "heading": return glyph("H");
    case "paragraph": return glyph("\u00B6");
    case "list": return glyph("\u2022");
    case "table": case "image": case "form_field":
    case "rect": case "line":
      return ICONS[type];
    default: return glyph("\u25A1");
  }
}

const ALIGN_TITLES = {
  "align-left": "Align left", "align-ch": "Center horizontally",
  "align-right": "Align right", "align-top": "Align top",
  "align-cv": "Center vertically", "align-bottom": "Align bottom",
};

// ---------------------------------------------------------------- helpers

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue; // null = explicitly do not set the attribute
    if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked") n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}

// pdfloom uses f64s; keep integers for draggability.
const snapPt = (v) => Math.round(v * 2) / 2; // 0.5pt grid
const fmtPt = (v) => Math.round(v * 100) / 100;

function pageOf(i) { return doc.pages[i]; }
function contentElements(page) {
  return page.elements.filter((e) => e.type !== "rect" && e.type !== "line");
}
function sortKey(e) { return e.order ?? 0; }

function uniqueName(base) {
  const names = new Set();
  for (const p of doc.pages) for (const e of p.elements)
    if (e.type === "form_field") names.add(e.name);
  let n = base, i = 1;
  while (names.has(n)) n = base + "_" + (++i);
  return n;
}

function defaultFont(size) {
  return { family: "Liberation Sans", style: "Regular", size, color: "#000000" };
}

function nextOrder(page) {
  return contentElements(page).reduce((m, e) => Math.max(m, e.order ?? 0), 0) + 1;
}

// A line's visible stroke always tracks the center of its bounding
// rect (the rect is the editor's drag/resize box; the builder draws
// exactly `from`/`to`). Every mutation goes through here so the
// three can never drift apart.
function syncLine(e) {
  const [x, y, w, h] = e.rect;
  const cy = y + h / 2;
  e.from = [x, cy];
  e.to = [x + w, cy];
}

// ---------------------------------------------------------------- history

function newDoc() {
  return {
    format: "pdfloom-doc", version: 1,
    profile: "ua1", title: "Untitled document", lang: "en-US",
    pages: [{ size: [612, 792], elements: [] }],
  };
}

function snapshot() {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 64) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(doc));
  doc = JSON.parse(undoStack.pop());
  sel = null;
  renderAll();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(doc));
  doc = JSON.parse(redoStack.pop());
  sel = null;
  renderAll();
}

// ---------------------------------------------------------------- elements

const CREATORS = {
  heading(page) {
    return { type: "heading", level: 1, text: "Heading",
             rect: [72, 680, 468, 28], font: { family: "Liberation Sans", style: "Bold", size: 20, color: "#000000" },
             order: nextOrder(page) };
  },
  paragraph(page) {
    return { type: "paragraph", text: "A paragraph. Double-click me to edit this text.",
             rect: [72, 600, 468, 60], font: defaultFont(11), order: nextOrder(page) };
  },
  list(page) {
    return { type: "list", items: ["First item", "Second item"],
             rect: [72, 500, 468, 56], font: defaultFont(11), order: nextOrder(page) };
  },
  table(page) {
    return { type: "table", rect: [72, 380, 468, 90],
             header: ["Column A", "Column B"], rows: [["one", "two"], ["three", "four"]],
             widths: [234, 234], font: defaultFont(10), order: nextOrder(page) };
  },
  image(page) {
    return { type: "image", src: "", alt: "",
             rect: [72, 300, 96, 96], order: nextOrder(page) };
  },
  form_field(page) {
    return { type: "form_field", label: "Field label", name: uniqueName("field"),
             rect: [72, 240, 300, 24], font: defaultFont(11), order: nextOrder(page) };
  },
  rect(page) {
    return { type: "rect", rect: [72, 120, 120, 60], fill: "#dde7f2", stroke: null,
             stroke_width: 1, order: 900 };
  },
  line(page) {
    const r = [72, 96, 324, 1];
    return { type: "line", rect: r, from: [72, 96.5], to: [396, 96.5],
             stroke: "#888888", stroke_width: 1, order: 901 };
  },
};

// Stagger newly added elements a little so repeated inserts don't
// land exactly on top of each other.
function cascade(page, e) {
  const n = contentElements(page).length + page.elements.length;
  const off = (n % 8) * 14;
  if (!off) return;
  e.rect = [snapPt(e.rect[0] + off), snapPt(e.rect[1] - off), e.rect[2], e.rect[3]];
  if (e.type === "line") syncLine(e);
}

function addElement(type) {
  if (type === "image") { $("image-file").click(); return; }
  snapshot();
  const page = pageOf(current);
  const e = CREATORS[type](page);
  cascade(page, e);
  page.elements.push(e);
  sel = e;
  renderAll();
}

function deleteElement(e) {
  if (!e) return;
  snapshot();
  const page = pageOf(current);
  const i = page.elements.indexOf(e);
  if (i >= 0) page.elements.splice(i, 1);
  if (sel === e) sel = null;
  renderAll();
}

function duplicate() {
  if (!sel) return;
  snapshot();
  const copy = JSON.parse(JSON.stringify(sel));
  copy.rect = [copy.rect[0] + 12, Math.max(12, copy.rect[1] - 12), copy.rect[2], copy.rect[3]];
  if (copy.type === "line") syncLine(copy);
  if (copy.type === "form_field") copy.name = uniqueName(copy.name);
  if (copy.order != null) copy.order = nextOrder(pageOf(current));
  pageOf(current).elements.push(copy);
  sel = copy;
  renderAll();
}

// ---------------------------------------------------------------- render

function renderAll() {
  renderPagesList();
  renderLayersList();
  renderCanvas();
  renderProps();
  updateToolbar();
  persist();
}

function updateToolbar() {
  $("undo-btn").disabled = undoStack.length === 0;
  $("redo-btn").disabled = redoStack.length === 0;
  $("toggle-order").classList.toggle("on", showOrder);
  $("toggle-preview").classList.toggle("on", showPreview);
  const t = $("doc-title");
  if (document.activeElement !== t) t.value = doc.title;
  $("zoom-pct").textContent = Math.round(zoom * 100) + "%";
}

function renderPagesList() {
  const list = $("pages-list");
  list.textContent = "";
  doc.pages.forEach((p, i) => {
    const thumb = el("button", {
      class: "page-thumb" + (i === current ? " active" : ""),
      onclick: () => { current = i; sel = null; renderAll(); },
      title: `Page ${i + 1} (${p.size[0]}x${p.size[1]}pt)`,
      "aria-label": `Go to page ${i + 1}`,
    });
    thumb.append(thumbPreview(p));
    thumb.append(el("span", { class: "pg-num" }, String(i + 1)));
    if (doc.pages.length > 1) {
      thumb.append(el("span", {
        class: "thumb-x", role: "button", title: "Remove page",
        "aria-label": `Remove page ${i + 1}`,
        onclick: (ev) => { ev.stopPropagation(); removePage(i); },
      }, "\u00D7"));
    }
    list.append(thumb);
  });
}

// A tiny percentage-scaled block preview of the page.
function thumbPreview(page) {
  const [w, h] = page.size;
  const wrap = el("span", { class: "thumb-canvas", "aria-hidden": "true" });
  for (const e of page.elements) {
    const [x, y, ew, eh] = e.rect;
    const d = el("span", { class: "thumb-el t-" + e.type, style: {
      left: (x / w * 100) + "%",
      top: ((1 - (y + eh) / h) * 100) + "%",
      width: (ew / w * 100) + "%",
      height: (Math.max(eh, e.type === "line" ? 1.5 : eh) / h * 100) + "%",
    } });
    if (e.type === "rect" && e.fill) d.style.background = e.fill;
    if (e.type === "line") d.style.background = e.stroke || "#888";
    wrap.append(d);
  }
  return wrap;
}

function removePage(i) {
  if (doc.pages.length <= 1) return;
  snapshot();
  doc.pages.splice(i, 1);
  current = Math.min(current, doc.pages.length - 1);
  sel = null;
  renderAll();
}

function renderLayersList() {
  const list = $("layers-list");
  list.textContent = "";
  const page = pageOf(current);
  const content = contentElements(page).slice().sort((a, b) => sortKey(a) - sortKey(b));
  const decor = page.elements.filter((e) => e.type === "rect" || e.type === "line");
  if (!content.length && !decor.length) {
    list.append(el("div", { class: "layers-empty" },
      "Nothing on this page yet. Add elements with the toolbar below the canvas."));
    return;
  }
  for (const e of content) list.append(layerRow(e, true));
  for (const e of decor) list.append(layerRow(e, false));
}

function layerRow(e, isContent) {
  const row = el("div", {
    class: "layer-row" + (sel === e ? " sel" : "") + (isContent ? "" : " decor"),
    onclick: (ev) => { select(e); if (ev.detail >= 2) startInlineEdit(e); },
    title: isContent ? "Reading position " + (e.order ?? 0) : "Decoration",
  });
  const ic = el("span", { class: "layer-ic" });
  ic.innerHTML = typeIcon(e.type);
  row.append(ic, el("span", { class: "layer-name" }, layerLabel(e)));
  if (isContent) row.append(el("span", { class: "layer-order" }, String(e.order ?? 0)));

  const actions = el("span", { class: "layer-actions" });
  if (isContent) {
    const up = el("button", { class: "mini", title: "Read earlier",
      onclick: (ev) => { ev.stopPropagation(); moveLayer(e, -1); } });
    up.innerHTML = ICONS.up;
    const dn = el("button", { class: "mini", title: "Read later",
      onclick: (ev) => { ev.stopPropagation(); moveLayer(e, 1); } });
    dn.innerHTML = ICONS.down;
    actions.append(up, dn);
  }
  const del = el("button", { class: "mini danger", title: "Delete",
    onclick: (ev) => { ev.stopPropagation(); deleteElement(e); } });
  del.innerHTML = ICONS.trash;
  actions.append(del);
  row.append(actions);
  return row;
}

function layerLabel(e) {
  const cut = (s, n = 36) => {
    s = String(s).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
  };
  switch (e.type) {
    case "heading": return "H" + (e.level ?? 1) + "  " + cut(e.text);
    case "paragraph": return cut(e.text) || "Paragraph";
    case "list": {
      const it = e.items || [];
      return it.length ? cut(it[0]) + (it.length > 1 ? `  +${it.length - 1}` : "") : "List";
    }
    case "table": return "Table  " + (e.header || []).join(", ");
    case "image": return e.alt ? cut(e.alt) : (e.src ? "Image" : "Empty image");
    case "form_field": return cut(e.label || e.name || "Field");
    case "rect": return "Box";
    case "line": return "Line";
    default: return e.type;
  }
}

// Swap a content element with its neighbor in reading order, then
// renumber the sequence 1..n (order only matters relatively).
function moveLayer(e, dir) {
  const page = pageOf(current);
  const content = contentElements(page).slice().sort((a, b) => sortKey(a) - sortKey(b));
  const i = content.indexOf(e);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= content.length) return;
  snapshot();
  [content[i], content[j]] = [content[j], content[i]];
  content.forEach((x, idx) => { x.order = idx + 1; });
  renderAll();
}

function renderCanvas() {
  if (editing) commitInline();
  const page = pageOf(current);
  const [w, h] = page.size;

  const sizer = $("canvas-sizer");
  sizer.style.width = (w * zoom + PAD * 2) + "px";
  sizer.style.height = (h * zoom + PAD * 2) + "px";

  $("page-label").textContent =
    `Page ${current + 1} \u00B7 ${fmtPt(w)}\u00D7${fmtPt(h)} pt`;

  $("scale-box").style.transform = `scale(${zoom})`;

  const pageEl = $("the-page");
  pageEl.textContent = "";
  pageEl.style.width = w + "px";
  pageEl.style.height = h + "px";

  // Decorations first (bottom z), then content in reading order.
  const ordered = contentElements(page).slice().sort((a, b) => sortKey(a) - sortKey(b));
  for (const e of page.elements) if (e.type === "rect" || e.type === "line")
    pageEl.append(elementView(e));
  for (const e of ordered) pageEl.append(elementView(e));
}

function elementView(e) {
  const [x, y, w, h] = e.rect;
  // DOM: top-left origin; PDF: bottom-left. Translate.
  const top = pageOf(current).size[1] - y - h;
  const box = el("div", {
    class: "element " + e.type + (sel === e ? " selected" : ""),
    style: { left: x + "px", top: top + "px", width: w + "px", height: h + "px" },
    onmousedown: (ev) => elementDown(ev, e),
    "data-type": e.type,
  });
  boxMap.set(e, box);

  const f = e.font || defaultFont(11);
  const cssFont = `${f.style === "Italic" || f.style === "Bold Italic" ? "italic " : ""}` +
    `${f.style === "Bold" || f.style === "Bold Italic" ? "700 " : ""}` +
    `${f.size}px ${cssFamily(f.family)}`;
  const color = f.color || "#000";

  switch (e.type) {
    case "heading":
    case "paragraph": {
      box.style.font = cssFont;
      box.style.color = color;
      box.textContent = e.text || "";
      break;
    }
    case "list": {
      box.style.font = cssFont; box.style.color = color;
      const ul = el("ul");
      for (const item of e.items || []) ul.append(el("li", {}, item));
      box.append(ul);
      break;
    }
    case "table": {
      const table = el("table", { style: { font: cssFont, color } });
      const trh = el("tr");
      for (const cell of e.header || []) trh.append(el("th", {}, cell));
      table.append(trh);
      for (const row of e.rows || []) {
        const tr = el("tr");
        for (let i = 0; i < (e.header || []).length; i++)
          tr.append(el("td", {}, row[i] ?? ""));
        table.append(tr);
      }
      if (e.widths) {
        table.style.tableLayout = "fixed";
        let i = 0;
        for (const th of table.rows[0].cells) th.style.width = e.widths[i++] + "px";
      }
      box.append(table);
      break;
    }
    case "image": {
      if (!e.src) {
        box.append(el("span", { class: "img-placeholder" }, "image"));
        box.classList.add("empty-image");
        box.append(el("div", { class: "hint" }, "double-click Properties to pick a file"));
      } else if (e.src.startsWith("data:")) {
        box.append(el("img", { src: e.src, alt: "" }));
      } else {
        box.append(el("span", { class: "img-placeholder" }, "img: " + e.src.split("/").pop()));
      }
      break;
    }
    case "form_field": {
      box.style.font = cssFont; box.style.color = color;
      const labelW = Math.round(w * 0.4);
      box.append(el("span", { class: "ff-label",
        style: { width: labelW + "px" } }, e.label || ""));
      box.append(el("span", { class: "ff-box",
        style: { left: labelW + "px", width: (w - labelW) + "px", height: h + "px" } }));
      break;
    }
    case "rect": {
      if (e.fill) box.style.background = e.fill;
      if (e.stroke) {
        box.style.border = `${e.stroke_width || 1}px solid ${e.stroke}`;
      }
      break;
    }
    case "line": {
      const dx = e.to[0] - e.from[0], dy = e.to[1] - e.from[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(-dy, dx); // DOM y is inverted
      const bar = el("div", { class: "line-bar",
        style: { width: len + "px",
                 borderTop: `${e.stroke_width || 1}px solid ${e.stroke || "#000"}`,
                 transform: `rotate(${ang}rad)` } });
      box.classList.add("line-el");
      box.style.height = "0px";
      box.append(bar);
      box.append(el("div", { class: "line-hit" }));
      break;
    }
  }

  if (showOrder && !e.type.match(/rect|line/)) {
    box.append(el("span", { class: "order-badge" }, String(e.order ?? 0)));
  }

  if (sel === e && editing !== e) {
    // Eight resize handles: four corners (both edges track the mouse)
    // and four edge midpoints (width-only or height-only resizing).
    // Spec keys name which PDF edges follow the drag.
    const HANDLES = [
      ["nw", { left: 1, top: 1 }, "0%", "0%"],
      ["n", { top: 1 }, "50%", "0%"],
      ["ne", { right: 1, top: 1 }, "100%", "0%"],
      ["e", { right: 1 }, "100%", "50%"],
      ["se", { right: 1, bottom: 1 }, "100%", "100%"],
      ["s", { bottom: 1 }, "50%", "100%"],
      ["sw", { left: 1, bottom: 1 }, "0%", "100%"],
      ["w", { left: 1 }, "0%", "50%"],
    ];
    for (const [cls, spec, hx, hy] of HANDLES) {
      box.append(el("div", { class: "handle " + cls,
        style: { left: hx, top: hy },
        onmousedown: (ev) => handleDown(ev, e, spec) }));
    }
  }
  return box;
}

function cssFamily(f) {
  switch (f) {
    case "Liberation Serif": case "Times-Roman": return '"Liberation Serif", "Times New Roman", serif';
    case "Liberation Mono": case "Courier": return '"Liberation Mono", "Courier New", monospace';
    case "Atkinson Hyperlegible": return '"Atkinson Hyperlegible", sans-serif';
    case "OpenDyslexic": return '"OpenDyslexic", "Comic Sans MS", sans-serif';
    default: return `"${f}", "Liberation Sans", Arial, sans-serif`;
  }
}

// ------------------------------------------------------------- interaction

// The page element is static in the HTML, so this listener is wired
// once (not per render like the old canvas rebuild).
$("the-page").addEventListener("mousedown", canvasBackgroundDown);

function canvasBackgroundDown(ev) {
  if (spaceDown || ev.button !== 0) return;
  if (ev.target.id !== "the-page") return;
  select(null);
  ev.preventDefault();
}

function elementDown(ev, e) {
  if (spaceDown) return;              // pan mode wins
  if (ev.button !== 0) return;        // middle/right click: no drag
  if (editing === e) return;          // placing the caret inside the editor
  if (ev.detail >= 2 && (e.type === "heading" || e.type === "paragraph")) {
    select(e);                        // renders a fresh box, then edit it
    startInlineEdit(e);
    return;
  }
  select(e);
  const startX = ev.clientX, startY = ev.clientY;
  const [x, y, w, h] = e.rect;
  let moved = false;
  const move = (ev2) => {
    const dx = (ev2.clientX - startX) / zoom;
    const dy = -(ev2.clientY - startY) / zoom; // invert: PDF y up
    if (Math.abs(dx) + Math.abs(dy) > 1) {
      if (!moved) { snapshot(); moved = true; }
      e.rect = [snapPt(x + dx), snapPt(y + dy), w, h];
      if (e.type === "line") syncLine(e);
      renderCanvas();
      syncGeom();
      const box = boxMap.get(e);
      if (box) showDim(`x ${e.rect[0]}   y ${e.rect[1]}`, box);
    }
  };
  const up = () => {
    hideDim();
    if (moved) persist();
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  ev.preventDefault();
  ev.stopPropagation();
}

// Resize from any combination of edges. The edges NOT in `spec` stay
// anchored; the edges in it track the mouse. Corners resize both
// dimensions, edge handles only one. Coordinates are PDF points with
// y growing upward, and dy is already inverted for that.
function handleDown(ev, e, spec) {
  if (spaceDown || ev.button !== 0) return;
  const startX = ev.clientX, startY = ev.clientY;
  const [x, y, w, h] = e.rect;
  let moved = false;
  const move = (ev2) => {
    const dx = (ev2.clientX - startX) / zoom;
    const dy = -(ev2.clientY - startY) / zoom;
    if (!moved) { snapshot(); moved = true; }
    let nx = x, ny = y, nw = w, nh = h;
    if (spec.left) {
      nx = snapPt(x + dx);
      nw = snapPt(w - (nx - x)); // keep the right edge anchored
    }
    if (spec.right) {
      nw = snapPt(w + dx); // left edge stays put
    }
    if (spec.top) {
      nh = snapPt(h + dy); // bottom edge stays put
    }
    if (spec.bottom) {
      ny = snapPt(y + dy);
      nh = snapPt(h - (ny - y)); // keep the top edge anchored
    }
    if (e.type === "line") {
      // A line's bounding box has no meaningful height: vertical
      // handle drags MOVE the line, horizontal ones stretch it.
      if (spec.top || spec.bottom) { ny = snapPt(y + dy); nh = h; }
      if (nw < 2) nw = 2;
      e.rect = [nx, ny, nw, nh];
      syncLine(e);
      renderCanvas();
      syncGeom();
      showDim(`${nw} \u00D7 ${nh}`, boxMap.get(e));
      return;
    }
    if (nw < 8) nw = 8;
    if (nh < 8) nh = 8;
    e.rect = [nx, ny, nw, nh];
    renderCanvas();
    syncGeom();
    showDim(`${nw} \u00D7 ${nh}`, boxMap.get(e));
  };
  const up = () => {
    hideDim();
    if (moved) persist();
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  ev.preventDefault();
  ev.stopPropagation();
}

function select(e) {
  if (editing && editing !== e) commitInline();
  sel = e;
  renderCanvas();
  renderProps();
  renderLayersList();
  updateToolbar();
}

// ------------------------------------------------------------- inline edit

function startInlineEdit(e) {
  if (e.type !== "heading" && e.type !== "paragraph") return;
  if (editing === e) return;
  if (editing) commitInline();
  if (sel !== e) select(e);
  const box = boxMap.get(e);
  if (!box) return;
  snapshot();
  editOrig = e.text || "";
  editing = e;

  const f = e.font || defaultFont(11);
  const area = el("textarea", {
    class: "inline-edit", value: editOrig, spellcheck: "false",
    "aria-label": "Edit text",
  });
  area.style.font = `${f.style === "Italic" || f.style === "Bold Italic" ? "italic " : ""}` +
    `${f.style === "Bold" || f.style === "Bold Italic" ? "700 " : ""}` +
    `${f.size}px ${cssFamily(f.family)}`;
  area.style.color = f.color || "#000";
  area.style.background = editBgFor(f.color || "#000");
  area.style.caretColor = f.color || "#000";

  box.classList.add("editing");
  box.textContent = ""; // the overlay becomes the only visible text
  box.append(area);
  area.addEventListener("blur", commitInline);
  area.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") { ev.preventDefault(); area.blur(); }
  });
  editArea = area;
  area.focus();
  area.select();
}

function commitInline() {
  if (!editing) return;
  const e = editing;
  editing = null;
  const area = editArea;
  editArea = null;
  const val = area ? area.value : editOrig;
  const changed = val !== editOrig;
  if (area) {
    area.removeEventListener("blur", commitInline);
    area.remove();
  }
  if (changed) e.text = val;
  else undoStack.pop(); // nothing changed: drop the pre-edit snapshot
  renderAll();
}

// Light text needs a dark editor background and vice versa.
function editBgFor(color) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#222831" : "#ffffff";
}

// --------------------------------------------------------- dim badge / zoom

function showDim(text, box) {
  if (!box) return;
  const wrap = $("canvas-wrap"), badge = $("dim-badge");
  const wr = wrap.getBoundingClientRect(), br = box.getBoundingClientRect();
  badge.textContent = text;
  badge.hidden = false;
  // Bars/badge live in the non-scrolling canvas area, so viewport
  // coordinates (no scroll offsets) are the right frame.
  badge.style.left = (br.left - wr.left) + "px";
  badge.style.top = (br.bottom - wr.top + 10) + "px";
}
function hideDim() { $("dim-badge").hidden = true; }

function clampZoom(z) { return Math.min(4, Math.max(0.1, z)); }
function setZoom(z) { zoom = clampZoom(z); renderCanvas(); updateToolbar(); }
function zoomIn() { setZoom(zoom * 1.25); }
function zoomOut() { setZoom(zoom / 1.25); }
function zoomFit() {
  const wrap = $("canvas-wrap");
  const [w, h] = pageOf(current).size;
  const z = Math.min((wrap.clientWidth - PAD * 2 - 16) / w,
                     (wrap.clientHeight - PAD * 2 - 16) / h);
  setZoom(Math.max(z, 0.1));
}

// Ctrl/Cmd+wheel zooms toward the cursor: keep the page point under
// the pointer at the same screen position after re-rendering.
const wrapEl = $("canvas-wrap");
wrapEl.addEventListener("wheel", (ev) => {
  if (!(ev.ctrlKey || ev.metaKey)) return;
  ev.preventDefault();
  const page = $("the-page");
  const before = page.getBoundingClientRect();
  const px = (ev.clientX - before.left) / zoom;
  const py = (ev.clientY - before.top) / zoom;
  const nz = clampZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
  setZoom(nz);
  const after = page.getBoundingClientRect();
  wrapEl.scrollLeft += (ev.clientX - (after.left + px * nz));
  wrapEl.scrollTop += (ev.clientY - (after.top + py * nz));
}, { passive: false });

// ------------------------------------------------------------- pan + click

wrapEl.addEventListener("mousedown", (ev) => {
  if (spaceDown || ev.button === 1) {
    ev.preventDefault(); // also stops middle-click autoscroll
    const sx = ev.clientX, sy = ev.clientY;
    const sl = wrapEl.scrollLeft, st = wrapEl.scrollTop;
    wrapEl.classList.add("grabbing");
    const move = (e2) => {
      wrapEl.scrollLeft = sl - (e2.clientX - sx);
      wrapEl.scrollTop = st - (e2.clientY - sy);
    };
    const up = () => {
      wrapEl.classList.remove("grabbing");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return;
  }
  // Left-click on the empty canvas (not the page, not an element): deselect.
  if (ev.button === 0 && (ev.target === wrapEl || ev.target.id === "canvas-sizer"))
    select(null);
});

document.addEventListener("keydown", (ev) => {
  const t = ev.target;
  if (t && t.closest && t.closest("input,textarea,select,[contenteditable]")) return;
  const mod = ev.metaKey || ev.ctrlKey;
  const key = ev.key.toLowerCase();

  if (ev.key === " ") {
    if (!spaceDown) { spaceDown = true; wrapEl.classList.add("panning"); }
    ev.preventDefault();
    return;
  }
  if (mod && key === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && key === "y") { ev.preventDefault(); redo(); return; }
  if (mod && key === "d") { ev.preventDefault(); duplicate(); return; }
  if (mod && key === "c") { ev.preventDefault(); copySel(); return; }
  if (mod && key === "x") { ev.preventDefault(); copySel(); deleteElement(sel); return; }
  if (mod && key === "v") { ev.preventDefault(); paste(); return; }
  if (mod && (ev.key === "=" || ev.key === "+")) { ev.preventDefault(); zoomIn(); return; }
  if (mod && ev.key === "-") { ev.preventDefault(); zoomOut(); return; }
  if (mod && ev.key === "0") { ev.preventDefault(); setZoom(1); return; }
  if (ev.shiftKey && !mod && ev.key === "0") { ev.preventDefault(); zoomFit(); return; }
  if (ev.key === "Escape") { select(null); return; }
  if (ev.key === "Enter" && sel) {
    if (sel.type === "heading" || sel.type === "paragraph") {
      ev.preventDefault(); startInlineEdit(sel);
    }
    return;
  }
  if (!sel) return;
  const nudge = ev.shiftKey ? 10 : 1;
  if (ev.key.startsWith("Arrow")) {
    const now = Date.now();
    if (now - lastNudge > 800) snapshot();
    lastNudge = now;
  }
  switch (ev.key) {
    case "Backspace": case "Delete":
      deleteElement(sel); ev.preventDefault(); break;
    case "ArrowLeft":
      sel.rect[0] = snapPt(sel.rect[0] - nudge);
      if (sel.type === "line") syncLine(sel);
      renderCanvas(); syncGeom(); persist(); ev.preventDefault(); break;
    case "ArrowRight":
      sel.rect[0] = snapPt(sel.rect[0] + nudge);
      if (sel.type === "line") syncLine(sel);
      renderCanvas(); syncGeom(); persist(); ev.preventDefault(); break;
    case "ArrowUp":
      sel.rect[1] = snapPt(sel.rect[1] + nudge);
      if (sel.type === "line") syncLine(sel);
      renderCanvas(); syncGeom(); persist(); ev.preventDefault(); break;
    case "ArrowDown":
      sel.rect[1] = snapPt(sel.rect[1] - nudge);
      if (sel.type === "line") syncLine(sel);
      renderCanvas(); syncGeom(); persist(); ev.preventDefault(); break;
  }
});

document.addEventListener("keyup", (ev) => {
  if (ev.key === " ") {
    spaceDown = false;
    wrapEl.classList.remove("panning");
  }
});

// ------------------------------------------------------------- clipboard

function copySel() {
  if (sel) clipboard = JSON.stringify(sel);
}

function paste() {
  if (!clipboard) return;
  snapshot();
  const c = JSON.parse(clipboard);
  c.rect = [snapPt(c.rect[0] + 16), snapPt(c.rect[1] - 16), c.rect[2], c.rect[3]];
  if (c.type === "line") syncLine(c);
  if (c.type === "form_field") c.name = uniqueName(c.name);
  if (c.order != null) c.order = nextOrder(pageOf(current));
  pageOf(current).elements.push(c);
  sel = c;
  renderAll();
}

// ------------------------------------------------------------- properties

function renderProps() {
  geomInputs = [];
  const insp = $("inspector");
  insp.textContent = "";

  if (!sel) {
    insp.append(el("div", { class: "insp-empty" },
      "Select an element to edit its properties. Double-click text elements to edit them in place."));
    insp.append(docSection(), pageSection());
    return;
  }

  // Header: element type + quick actions.
  const head = el("div", { class: "insp-head" });
  head.append(el("span", { class: "insp-type" }, sel.type.replace("_", " ")));
  const acts = el("span", { class: "insp-actions" });
  const dup = el("button", { class: "mini", title: "Duplicate (Ctrl/Cmd+D)", onclick: duplicate });
  dup.innerHTML = ICONS.duplicate;
  const del = el("button", { class: "mini danger", title: "Delete", onclick: () => deleteElement(sel) });
  del.innerHTML = ICONS.trash;
  acts.append(dup, del);
  head.append(acts);
  insp.append(head);

  insp.append(alignSection());
  insp.append(positionSection());
  if (!/^(rect|line)$/.test(sel.type)) insp.append(orderSection());

  switch (sel.type) {
    case "heading": {
      insp.append(sec("Heading",
        labeled("Level", number(1, 6, 1, sel.level, (v) => { snapshot(); sel.level = v; renderAll(); }))));
      insp.append(sec("Text",
        labeled(null, textArea(sel.text, (v) => { snapshot(); sel.text = v; renderCanvas(); }))));
      insp.append(fontSection());
      break;
    }
    case "paragraph": {
      insp.append(sec("Text",
        labeled(null, textArea(sel.text, (v) => { snapshot(); sel.text = v; renderCanvas(); }))));
      insp.append(fontSection());
      break;
    }
    case "list": {
      insp.append(sec("Items (one per line)",
        labeled(null, textArea((sel.items || []).join("\n"),
          (v) => { snapshot(); sel.items = v.split("\n"); renderCanvas(); }))));
      insp.append(fontSection());
      break;
    }
    case "table": {
      insp.append(sec("Header (comma-separated)",
        labeled(null, input((sel.header || []).join(", "),
          (v) => { snapshot(); sel.header = v.split(",").map((s) => s.trim()); renderCanvas(); }))));
      insp.append(sec("Rows (one per line, cells by comma)",
        labeled(null, textArea((sel.rows || []).map((r) => r.join(", ")).join("\n"),
          (v) => { snapshot(); sel.rows = v.split("\n").map((line) => line.split(",").map((s) => s.trim())).filter((r) => r.length); renderCanvas(); }))));
      insp.append(fontSection());
      break;
    }
    case "image": {
      insp.append(sec("Image",
        el("button", { class: "pick-image", onclick: () => $("image-file").click() }, "Choose PNG/JPEG"),
        labeled("Alt text (empty = decorative)",
          input(sel.alt || "", (v) => { snapshot(); sel.alt = v; renderCanvas(); }))));
      break;
    }
    case "form_field": {
      insp.append(sec("Field",
        labeled("Label", input(sel.label || "", (v) => { snapshot(); sel.label = v; renderCanvas(); })),
        labeled("Field name (/T)", input(sel.name || "", (v) => { snapshot(); sel.name = v; }))));
      insp.append(fontSection());
      break;
    }
    case "rect": {
      insp.append(sec("Fill",
        colorField("Color", sel.fill || "", true, (v) => { snapshot(); sel.fill = v; renderCanvas(); })));
      insp.append(sec("Stroke",
        colorField("Color", sel.stroke || "", true, (v) => { snapshot(); sel.stroke = v; renderCanvas(); }),
        labeled("Width (pt)", number(0.25, 12, 0.25, sel.stroke_width ?? 1, (v) => { snapshot(); sel.stroke_width = v; renderCanvas(); }))));
      break;
    }
    case "line": {
      insp.append(sec("Stroke",
        colorField("Color", sel.stroke || "#000000", false, (v) => { snapshot(); sel.stroke = v; renderCanvas(); }),
        labeled("Width (pt)", number(0.25, 12, 0.25, sel.stroke_width ?? 1, (v) => { snapshot(); sel.stroke_width = v; renderCanvas(); }))));
      break;
    }
  }
}

function sec(title, ...kids) {
  const s = el("div", { class: "sec" });
  if (title) s.append(el("h4", { class: "sec-title" }, title));
  for (const k of kids) if (k) s.append(k);
  return s;
}

function docSection() {
  return sec("Document",
    labeled("Title", input(doc.title, (v) => { snapshot(); doc.title = v; updateToolbar(); })),
    labeled("Language", input(doc.lang, (v) => { snapshot(); doc.lang = v; })),
    labeled("Profile", selectFor(["ua1", "ua2"], doc.profile, (v) => { snapshot(); doc.profile = v; })));
}

function pageSection() {
  const page = pageOf(current);
  const entries = Object.entries(PAGE_SIZES);
  const matchKey = entries.find(([, v]) =>
    Math.abs(v[0] - page.size[0]) < 0.01 && Math.abs(v[1] - page.size[1]) < 0.01);
  const s = el("select", { class: "field-input", "aria-label": "Page size" });
  if (matchKey) s.append(el("option", { value: matchKey[0] }, matchKey[0]));
  else s.append(el("option", { value: "" },
    `Custom (${fmtPt(page.size[0])}\u00D7${fmtPt(page.size[1])})`));
  for (const [k] of entries) if (k !== (matchKey && matchKey[0])) s.append(el("option", { value: k }, k));
  s.addEventListener("change", () => {
    const [w, h] = PAGE_SIZES[s.value] || page.size;
    if (w === page.size[0] && h === page.size[1]) return;
    snapshot();
    page.size = [w, h];
    renderAll();
  });
  return sec("Page " + (current + 1), labeled("Size", s));
}

function alignSection() {
  const s = el("div", { class: "sec" });
  s.append(el("h4", { class: "sec-title" }, "Align to page"));
  const row = el("div", { class: "align-row" });
  for (const m of ["align-left", "align-ch", "align-right", "align-top", "align-cv", "align-bottom"]) {
    const b = el("button", { class: "mini", title: ALIGN_TITLES[m], onclick: () => alignSel(m) });
    b.innerHTML = ICONS[m];
    row.append(b);
  }
  s.append(row);
  return s;
}

function alignSel(mode) {
  if (!sel) return;
  const [pw, ph] = pageOf(current).size;
  const [x, y, w, h] = sel.rect;
  let nx = x, ny = y;
  if (mode === "align-left") nx = 0;
  if (mode === "align-ch") nx = (pw - w) / 2;
  if (mode === "align-right") nx = pw - w;
  if (mode === "align-top") ny = ph - h;   // PDF origin is bottom-left
  if (mode === "align-cv") ny = (ph - h) / 2;
  if (mode === "align-bottom") ny = 0;
  if (nx === x && ny === y) return;
  snapshot();
  sel.rect = [snapPt(nx), snapPt(ny), w, h];
  if (sel.type === "line") syncLine(sel);
  renderCanvas();
  syncGeom();
  persist();
}

// Position & size: four editable fields, synced live while dragging
// without rebuilding the inspector (no focus loss while typing).
function positionSection() {
  const s = el("div", { class: "sec" });
  s.append(el("h4", { class: "sec-title" }, "Position & size"));
  const grid = el("div", { class: "pos-grid" });
  ["X", "Y", "W", "H"].forEach((lab, idx) => {
    const i = el("input", { type: "number", step: "0.5", "aria-label": lab });
    i.value = fmtPt(sel.rect[idx]);
    if (sel.type === "line" && idx === 3) i.disabled = true; // height is the drag box
    i.addEventListener("change", () => {
      if (!sel) return;
      const v = parseFloat(i.value);
      if (isNaN(v)) { i.value = fmtPt(sel.rect[idx]); return; }
      const arr = sel.rect.slice();
      arr[idx] = snapPt(v);
      if (sel.type === "line") {
        if (idx === 2 && arr[2] < 2) arr[2] = 2;
      } else {
        if (idx === 2 && arr[2] < 8) arr[2] = 8;
        if (idx === 3 && arr[3] < 8) arr[3] = 8;
      }
      snapshot();
      sel.rect = arr;
      if (sel.type === "line") syncLine(sel);
      renderCanvas();
      syncGeom();
      persist();
    });
    geomInputs.push({ i, idx });
    grid.append(el("label", { class: "pos-field" }, el("span", { class: "pos-lab" }, lab), i));
  });
  s.append(grid);
  s.append(el("p", { class: "sec-note" }, "PDF points, origin bottom-left."));
  return s;
}

function syncGeom() {
  for (const g of geomInputs)
    if (sel && document.activeElement !== g.i) g.i.value = fmtPt(sel.rect[g.idx]);
}

function orderSection() {
  const s = el("div", { class: "sec" });
  s.append(el("h4", { class: "sec-title" }, "Reading order"));
  const row = el("div", { class: "order-row" });
  const dec = el("button", { class: "mini", title: "Read earlier" });
  dec.innerHTML = ICONS.up;
  const inc = el("button", { class: "mini", title: "Read later" });
  inc.innerHTML = ICONS.down;
  const inp = el("input", { type: "number", min: "0", step: "1",
    class: "field-input order-input", "aria-label": "Reading order" });
  inp.value = sel.order ?? 0;
  const set = (v) => {
    if (!sel) return;
    v = Math.max(0, Math.round(v));
    if (v === (sel.order ?? 0)) return;
    snapshot();
    sel.order = v;
    renderAll();
  };
  dec.addEventListener("click", () => set((sel?.order ?? 0) - 1));
  inc.addEventListener("click", () => set((sel?.order ?? 0) + 1));
  inp.addEventListener("change", () => set(parseInt(inp.value, 10) || 0));
  row.append(dec, inp, inc);
  s.append(row);
  s.append(el("p", { class: "sec-note" }, "Lower numbers are read first by screen readers."));
  return s;
}

function fontSection() {
  const f = sel.font || defaultFont(11);
  const setFont = (mut) => {
    snapshot();
    const fo = sel.font ||= defaultFont(11);
    mut(fo);
    renderAll();
  };
  const s = el("div", { class: "sec" });
  s.append(el("h4", { class: "sec-title" }, "Font"));

  const row1 = el("div", { class: "two-col" });
  row1.append(labeled("Family", selectFor(FONT_FAMILIES, f.family, (v) => setFont((fo) => {
    fo.family = v;
    fo.style = clampStyle(v, fo.style); // keep the combo buildable
  }))));
  row1.append(labeled("Style", selectFor(stylesFor(f.family), f.style,
    (v) => setFont((fo) => { fo.style = v; }))));

  const row2 = el("div", { class: "two-col" });
  row2.append(labeled("Size (pt)", number(4, 96, 0.5, f.size, (v) => setFont((fo) => { fo.size = v; }))));

  const colorWrap = el("div", { class: "color-field" });
  const norm = /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : "#000000";
  const swatch = el("input", { type: "color", value: norm, title: "Text color",
    "aria-label": "Text color" });
  const hex = el("input", { type: "text", class: "field-input", value: f.color || "#000000",
    spellcheck: "false", "aria-label": "Text color hex" });
  const commit = (v) => {
    const t = String(v || "").trim();
    if (/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(t)) {
      setFont((fo) => { fo.color = t.startsWith("#") ? t : "#" + t; });
    } else { hex.value = f.color || "#000000"; }
  };
  swatch.addEventListener("input", () => { hex.value = swatch.value; commit(swatch.value); });
  hex.addEventListener("change", () => commit(hex.value));
  colorWrap.append(swatch, hex);
  row2.append(labeled("Color", colorWrap));

  s.append(row1, row2);
  return s;
}

// Color + hex pair used for fills and strokes. `allowEmpty` models
// "no fill" / "no stroke" (null in the config).
function colorField(label, value, allowEmpty, apply) {
  const wrapEl2 = el("div", { class: "color-field" });
  const norm = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  const swatch = el("input", { type: "color", value: norm,
    title: label, "aria-label": label });
  const hex = el("input", { type: "text", class: "field-input", value: value || "",
    placeholder: allowEmpty ? "#rrggbb (empty = none)" : "#rrggbb",
    spellcheck: "false" });
  const commit = (v) => {
    const t = String(v || "").trim();
    if (allowEmpty && t === "") { apply(null); return; }
    if (/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(t)) {
      apply(t.startsWith("#") ? t : "#" + t);
    } else { hex.value = value || ""; }
  };
  swatch.addEventListener("input", () => { hex.value = swatch.value; commit(swatch.value); });
  hex.addEventListener("change", () => commit(hex.value));
  wrapEl2.append(swatch, hex);
  return labeled(label, wrapEl2);
}

function labeled(label, control) {
  const l = el("label", { class: "prop" });
  if (label) l.append(el("span", { class: "prop-label" }, label));
  l.append(control);
  return l;
}
function input(value, onchange) {
  const i = el("input", { type: "text", class: "field-input", value });
  i.addEventListener("change", () => onchange(i.value));
  i.addEventListener("input", () => { i._t && clearTimeout(i._t); i._t = setTimeout(() => onchange(i.value), 400); });
  return i;
}
function textArea(value, onchange) {
  const t = el("textarea", { class: "field-input", value });
  t.addEventListener("change", () => onchange(t.value));
  t.addEventListener("input", () => { t._t && clearTimeout(t._t); t._t = setTimeout(() => onchange(t.value), 400); });
  return t;
}
function number(min, max, step, value, onchange) {
  const i = el("input", { type: "number", min, max, step, class: "field-input", value });
  i.addEventListener("change", () => { const v = parseFloat(i.value); if (!isNaN(v)) onchange(v); });
  return i;
}
function selectFor(options, value, onchange) {
  const s = el("select", { class: "field-input" });
  for (const o of options) s.append(el("option", { value: o, selected: o === value ? "" : null }, o));
  s.addEventListener("change", () => onchange(s.value));
  return s;
}

// ------------------------------------------------------------- toolbar

// Inject icons + labels into every [data-icon] button once at init.
for (const b of document.querySelectorAll("[data-icon]")) {
  const ic = ICONS[b.dataset.icon] || glyph(b.dataset.icon);
  b.innerHTML = ic + (b.dataset.label ? `<span class="btn-label">${b.dataset.label}</span>` : "");
}

for (const b of document.querySelectorAll("[data-add]"))
  b.addEventListener("click", () => addElement(b.dataset.add));

$("add-page").addEventListener("click", () => {
  snapshot();
  const key = $("page-size").value;
  const [w, h] = PAGE_SIZES[key] || [612, 792];
  doc.pages.push({ size: [w, h], elements: [] });
  current = doc.pages.length - 1;
  sel = null;
  renderAll();
});

for (const [k] of Object.entries(PAGE_SIZES))
  $("page-size").append(el("option", { value: k }, k));

$("undo-btn").addEventListener("click", undo);
$("redo-btn").addEventListener("click", redo);
$("zoom-in").addEventListener("click", zoomIn);
$("zoom-out").addEventListener("click", zoomOut);
$("zoom-pct").addEventListener("click", () => setZoom(1));
$("zoom-fit").addEventListener("click", zoomFit);

$("toggle-order").addEventListener("click", () => {
  showOrder = !showOrder;
  renderCanvas();
  updateToolbar();
});

// Document title field (top bar): snapshot the pre-edit state on
// focus; drop the snapshot again if nothing changed on blur.
const titleInput = $("doc-title");
titleInput.addEventListener("focus", () => { titleOrig = doc.title; snapshot(); });
titleInput.addEventListener("input", () => { doc.title = titleInput.value; persist(); });
titleInput.addEventListener("blur", () => {
  if (doc.title === titleOrig) undoStack.pop();
  titleOrig = null;
  updateToolbar();
});

$("new-doc").addEventListener("click", () => {
  if (!confirm("Discard this document and start fresh?")) return;
  snapshot();
  doc = newDoc();
  sel = null;
  current = 0;
  renderAll();
  setBadge("not built yet", "unknown");
  clearPreview();
});

// ---------------------------------------------------------------- files

$("image-file").addEventListener("change", async () => {
  const file = $("image-file").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (!sel || sel.type !== "image") {
      // Adding a NEW image element with this file.
      snapshot();
      const page = pageOf(current);
      const e = CREATORS.image(page);
      cascade(page, e);
      e.src = reader.result; // data: URL
      e.alt = file.name.replace(/\.[a-z]+$/i, "");
      page.elements.push(e);
      sel = e;
    } else {
      snapshot(); sel.src = reader.result;
    }
    renderAll();
  };
  reader.readAsDataURL(file);
  $("image-file").value = "";
});

$("export-config").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
    (doc.title || "document").replace(/[^\w-]+/g, "_") + ".pdfloom.json");
});

$("import-config").addEventListener("click", () => $("config-file").click());
$("config-file").addEventListener("change", async () => {
  const file = $("config-file").files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.format !== "pdfloom-doc") throw new Error("not a pdfloom-doc file");
    snapshot();
    doc = parsed;
    current = 0; sel = null;
    renderAll();
    zoomFit();
    setStatus("config imported");
  } catch (e) {
    alert("Could not import: " + e.message);
  }
  $("config-file").value = "";
});

// --------------------------------------------------------------- export

// Show a centered state message in the preview pane; kind is "" (idle
// placeholder), "loading" or "error". No message = hide the overlay.
function previewState(message, kind = "") {
  const state = $("preview-state");
  $("preview-message").textContent = message || "";
  state.classList.toggle("loading", kind === "loading");
  state.classList.toggle("error", kind === "error");
  state.hidden = !message;
}

async function buildPdf() {
  setStatus("building...");
  if (showPreview) previewState("Building the PDF\u2026", "loading");
  try {
    const res = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ def: doc }),
    });
    if (!res.ok) {
      const t = await res.text();
      setBadge("build error", "bad");
      setStatus("build failed: " + t.slice(0, 300));
      if (showPreview) previewState("The build failed:\n" + t.slice(0, 300), "error");
      return null;
    }
    const data = await res.json();
    showReport(data.report);
    const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
    return bytes;
  } catch (e) {
    setBadge("offline?", "bad");
    setStatus("could not reach pdfloom-server: " + e.message);
    if (showPreview) previewState("Could not reach pdfloom-server:\n" + e.message, "error");
    return null;
  }
}

function showReport(r) {
  if (String(r.status).toLowerCase() === "compliant") {
    setBadge("PDF/UA compliant", "ok");
    setStatus("compliant as " + r.profile_name);
  } else {
    setBadge("not compliant yet", "warn");
    const vs = (r.violations || []).map((v) => `${v.id}: ${v.message}`).join("; ");
    setStatus("file saved WITHOUT the conformance claim. " + (vs || r.note || ""));
  }
}

$("export-pdf").addEventListener("click", async () => {
  const bytes = await buildPdf();
  if (bytes) {
    downloadBlob(new Blob([bytes], { type: "application/pdf" }),
      (doc.title || "document").replace(/[^\w-]+/g, "_") + ".pdf");
    // Also refresh the preview if open.
    if (showPreview) showPdfInPreview(bytes);
  }
});

// Load bytes into the preview iframe (one object URL at a time).
function showPdfInPreview(bytes) {
  const frame = $("preview-frame");
  if (frame.dataset.url) URL.revokeObjectURL(frame.dataset.url);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  frame.dataset.url = url;
  frame.src = url;
  previewState(null); // hide any placeholder/loading/error overlay
}

function clearPreview() {
  const frame = $("preview-frame");
  if (frame.dataset.url) URL.revokeObjectURL(frame.dataset.url);
  delete frame.dataset.url;
  frame.src = "about:blank";
  if (showPreview) previewState("Click preview to build the PDF");
}

async function refreshPreview() {
  const b = await buildPdf();
  if (b) showPdfInPreview(b);
}

// The preview swaps in over the inspector (same column, Figma-like).
function togglePreview(on) {
  showPreview = on;
  $("preview-panel").hidden = !on;
  $("right-panel").hidden = on;
  updateToolbar();
  if (on) {
    if (!$("preview-frame").dataset.url) {
      previewState("Building the PDF\u2026", "loading");
      refreshPreview();
    }
  }
}

$("toggle-preview").addEventListener("click", () => togglePreview(!showPreview));
$("preview-close").addEventListener("click", () => togglePreview(false));
$("preview-refresh").addEventListener("click", refreshPreview);

function downloadBlob(blob, name) {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function setBadge(text, cls) { $("compliance-badge").textContent = text; $("compliance-badge").className = cls; }
function setStatus(text) { $("status-text").textContent = text; }

// ------------------------------------------------------------ persistence

function persist() {
  try { localStorage.setItem("pdfloom-studio-doc", JSON.stringify(doc)); } catch {}
}

(function init() {
  try {
    const saved = JSON.parse(localStorage.getItem("pdfloom-studio-doc"));
    if (saved && saved.format === "pdfloom-doc") doc = saved;
  } catch {}
  if (!doc) doc = newDoc();
  renderAll();
  requestAnimationFrame(() => zoomFit()); // start fitted, Figma-style
  if (location.hash === "#selftest") runSelfTest();
})();

// --------------------------------------------------------------- self test
// Headless smoke test (Chrome --headless --dump-dom ...#selftest):
// drives the real event handlers and reports PASS/FAIL lines into a
// <pre id="selftest-results"> appended to the body.

async function runSelfTest() {
  const pre = el("pre", { id: "selftest-results" });
  document.body.append(pre);
  let pass = 0, fail = 0;
  const t = (name, fn) => {
    try { fn(); pass++; pre.append("PASS " + name + "\n"); }
    catch (e) { fail++; pre.append("FAIL " + name + ": " + e.message + "\n"); }
  };
  const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
  const mouse = (target, type, x, y, extra = {}) =>
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
  const center = (node) => {
    const r = node.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };

  doc = newDoc(); // don't test against localStorage leftovers
  sel = null; undoStack = []; redoStack = [];
  renderAll();

  t("fresh document renders one empty page", () => {
    assert(doc.pages.length === 1 && pageOf(0).elements.length === 0);
  });

  t("add heading selects it and pushes undo", () => {
    addElement("heading");
    assert(pageOf(0).elements.length === 1 && sel && sel.type === "heading");
    assert(undoStack.length === 1);
  });

  t("drag moves the element", () => {
    const box = document.querySelector(".element");
    const [x, y] = center(box);
    const x0 = sel.rect[0], y0 = sel.rect[1];
    mouse(box, "mousedown", x, y);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: x + 40, clientY: y + 20 }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: x + 40, clientY: y + 20 }));
    assert(sel.rect[0] !== x0 || sel.rect[1] !== y0, "rect did not move");
    assert(Math.abs(sel.rect[0] - x0 - 40 / zoom) < 1.01, "dx wrong");
    // DOM y is inverted: moving the mouse DOWN (+20 px) lowers the
    // element's PDF y by 20/zoom.
    assert(Math.abs(y0 - sel.rect[1] - 20 / zoom) < 1.01, "dy wrong");
  });

  t("se handle resizes width+height", () => {
    const h = document.querySelector(".handle.se");
    assert(h, "no handle rendered");
    const [x, y] = center(h);
    const w0 = sel.rect[2], h0 = sel.rect[3];
    mouse(h, "mousedown", x, y);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: x + 30, clientY: y + 30 }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: x + 30, clientY: y + 30 }));
    assert(Math.abs(sel.rect[2] - w0 - 30 / zoom) < 1.01, "width wrong");
    assert(Math.abs(sel.rect[3] - h0 - 30 / zoom) < 1.01, "height wrong");
  });

  t("undo/redo round-trip the element", () => {
    // Stack at this point (newest last): pre-add, pre-drag, pre-resize.
    undo(); undo(); // back to just before the drag: element still there
    assert(pageOf(0).elements.length === 1, "geometry undos removed the element");
    undo();          // back to the empty page
    assert(pageOf(0).elements.length === 0, "undo did not remove");
    redo(); redo(); redo();
    assert(pageOf(0).elements.length === 1, "redos did not restore");
  });

  t("copy + paste offsets and renumbers", () => {
    sel = pageOf(0).elements[0];
    renderAll();
    copySel();
    const before = JSON.parse(JSON.stringify(sel));
    paste();
    assert(pageOf(0).elements.length === 2);
    const c = pageOf(0).elements[1];
    assert(c.rect[0] === before.rect[0] + 16 && c.rect[1] === before.rect[1] - 16);
    assert(c.order === before.order + 1, "paste order wrong");
  });

  t("form field names stay unique", () => {
    addElement("form_field"); addElement("form_field");
    const names = pageOf(0).elements.filter((e) => e.type === "form_field")
      .map((e) => e.name);
    assert(new Set(names).size === names.length, "duplicate names: " + names);
  });

  t("inline edit commits text and undo restores", () => {
    const h = pageOf(0).elements.find((e) => e.type === "heading");
    sel = h; renderAll();
    startInlineEdit(h);
    assert(editArea && editArea.value === h.text, "editor not populated");
    editArea.value = "Renamed by selftest";
    commitInline();
    assert(h.text === "Renamed by selftest", "text not committed");
    undo();
    assert(pageOf(0).elements.find((e) => e.type === "heading").text !== "Renamed by selftest",
      "undo did not restore");
    redo();
  });

  t("moveLayer reorders reading order", () => {
    addElement("paragraph");
    const ps = contentElements(pageOf(0)).filter((e) => e.type === "paragraph");
    const page = pageOf(0);
    if (ps.length < 2) { page.elements.push({ ...CREATORS.paragraph(page), text: "p2" }); }
    renderAll();
    const ordered = contentElements(page).slice().sort((a, b) => sortKey(a) - sortKey(b));
    const first = ordered[0], second = ordered[1];
    moveLayer(second, -1);
    const after = contentElements(page).slice().sort((a, b) => sortKey(a) - sortKey(b));
    assert(after[0] === second && after[1] === first, "order did not swap");
    assert(after[0].order === 1 && after[1].order === 2, "orders not renumbered");
  });

  t("add + remove page keeps one page", () => {
    assert(doc.pages.length === 1);
    $("add-page").click();
    assert(doc.pages.length === 2, "add-page did not run");
    removePage(1);
    assert(doc.pages.length === 1);
  });

  t("renderAll is schema-pure (no UI fields leak)", () => {
    const before = JSON.stringify(doc);
    renderAll();
    assert(JSON.stringify(doc) === before, "renderAll mutated the config");
    for (const p of doc.pages) for (const e of p.elements)
      for (const k of Object.keys(e))
        assert(!k.startsWith("_") && k !== "editing", "stray field " + k);
  });

  t("escape deselects", () => {
    sel = pageOf(0).elements[0]; renderAll();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(sel === null, "escape did not deselect");
  });

  try {
    const bytes = await buildPdf();
    if (bytes) { pass++; pre.append("PASS build endpoint returns a PDF (" + bytes.length + " bytes)\n"); }
    else { fail++; pre.append("FAIL build endpoint returned no bytes\n"); }
  } catch (e) { fail++; pre.append("FAIL build endpoint threw: " + e.message + "\n"); }

  pre.append(`SELFTEST DONE ${pass} pass ${fail} fail\n`);
}
