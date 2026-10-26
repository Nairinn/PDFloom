//! pdfloom-wasm: the in-browser PDF engine for PDFloom Studio.
//!
//! Thin wasm-bindgen bindings over the same crates the CLI and server
//! use, so a pdfloom-doc config builds to byte-identical PDFs natively
//! and in the browser. Everything runs in memory: fonts arrive as
//! registered bytes (the editor lazy-fetches the bundled OFL faces),
//! images arrive as `data:` URLs, and no filesystem, clock or RNG is
//! involved anywhere in the build path.

use wasm_bindgen::prelude::*;

/// The engine version (matches the pdfloom workspace version).
#[must_use]
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The bundled font catalog as JSON: `[{family, style, file}, ...]`
/// where `file` is the path under the deployed `/fonts/` directory
/// (mirrors the repo's `fonts/` tree). The editor lazy-fetches the
/// faces a document actually references; the two Noto CJK JP faces are
/// excluded from the default deploy and simply fail to fetch.
#[must_use]
#[wasm_bindgen]
pub fn catalog() -> String {
    let list = pdfloom_fonts::CATALOG
        .iter()
        .map(|e| serde_json::json!({ "family": e.family, "style": e.style, "file": e.file }))
        .collect::<Vec<_>>();
    serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())
}

/// Font files the caller registered, keyed by family + style. The
/// editor lazy-fetches the bundled OFL fonts from `/fonts/vendor/...`,
/// builds one of these, and hands it to [`build`] or [`retag`]. Fonts
/// registered here win over every other source for their family.
#[wasm_bindgen]
pub struct FontBundle {
    /// (family, style, bytes) triples in registration order.
    entries: Vec<(String, String, Vec<u8>)>,
}

#[wasm_bindgen]
impl FontBundle {
    /// An empty bundle.
    #[must_use]
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Register one face. Call this for every (family, style) the
    /// document references before building.
    pub fn add(&mut self, family: &str, style: &str, data: &[u8]) {
        self.entries
            .push((family.to_string(), style.to_string(), data.to_vec()));
    }

    /// Number of registered faces.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when no face is registered.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Default for FontBundle {
    fn default() -> Self {
        Self::new()
    }
}

/// A build result: the PDF bytes plus the save report as JSON.
///
/// The report JSON matches the pdfloom-server `/api/build` wire format
/// exactly (`status`, `profile_name`, `note`, `violations[]`,
/// `human_review[]`), so the Studio UI treats both engines alike.
#[wasm_bindgen]
pub struct BuildOutput {
    /// Serialized PDF file.
    pdf: Vec<u8>,
    /// Save report in the server's wire JSON format.
    report: String,
}

#[wasm_bindgen]
impl BuildOutput {
    /// The PDF bytes.
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn pdf(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(&self.pdf[..])
    }

    /// The save report as JSON text.
    #[must_use]
    #[wasm_bindgen(getter)]
    pub fn report(&self) -> String {
        self.report.clone()
    }
}

/// Serialize a save report in the pdfloom-server wire format.
fn report_json(r: &pdfloom_profile::SaveReport) -> String {
    let dto = serde_json::json!({
        "status": format!("{:?}", r.status).to_lowercase(),
        "profile_name": r.profile.name(),
        "note": r.note(),
        "violations": r.violations
            .iter()
            .map(|v| serde_json::json!({ "id": v.id, "message": v.message, "fix": v.fix }))
            .collect::<Vec<_>>(),
        "human_review": r.human_review,
    });
    serde_json::to_string(&dto).unwrap_or_else(|_| "{}".into())
}

/// Build a `pdfloom-doc` JSON config into a tagged PDF, entirely in
/// memory. `fonts` must contain every font the document references
/// (register at least Liberation Sans Regular). The bytes this returns
/// are identical to what native `pdfloom build` produces for the same
/// config and font data.
///
/// # Errors
///
/// A `JsString` describing the parse or build failure.
#[allow(clippy::needless_pass_by_value)]
#[wasm_bindgen]
pub fn build(config_json: &str, fonts: &FontBundle) -> Result<BuildOutput, JsValue> {
    if fonts.is_empty() {
        return Err(JsValue::from_str(
            "FontBundle is empty: register the fonts the document uses \
             (at minimum Liberation Sans Regular) before building",
        ));
    }
    let def = pdfloom_def::parse_def(config_json.as_bytes())
        .map_err(|e| JsValue::from_str(&format!("config: {e}")))?;
    let (pdf, report) = pdfloom_def::build_to_bytes_with(&def, |doc| {
        for (family, style, data) in &fonts.entries {
            doc.register_font_bytes(family, style, data.clone());
        }
    })
    .map_err(|e| JsValue::from_str(&format!("build: {e}")))?;
    Ok(BuildOutput {
        pdf,
        report: report_json(&report),
    })
}

/// Run the Matterhorn machine checks over an in-memory PDF and return
/// the findings as JSON (`findings[]` with `id`/`message`/`context`,
/// plus `review[]`).
///
/// # Errors
///
/// A `JsString` when the bytes are not a parsable PDF.
#[wasm_bindgen]
pub fn validate(pdf: &[u8]) -> Result<String, JsValue> {
    let mut reader = pdfloom_parse::PdfReader::from_bytes(pdf.to_vec())
        .map_err(|e| JsValue::from_str(&format!("parse: {e}")))?;
    let report =
        pdfloom_validate::validate_reader(&mut reader).map_err(|e| JsValue::from_str(&e))?;
    let dto = serde_json::json!({
        "findings": report
            .findings
            .iter()
            .map(|f| serde_json::json!({ "id": f.id, "message": f.message, "context": f.context }))
            .collect::<Vec<_>>(),
        "review": report.review,
    });
    Ok(serde_json::to_string(&dto).unwrap_or_else(|_| "{}".into()))
}

/// Rasterize one page (0-based) of an in-memory PDF to PNG bytes at the
/// given DPI (72 = 1 point per pixel).
///
/// # Errors
///
/// A `JsString` when the bytes are not a parsable PDF or the page index
/// is out of range.
#[wasm_bindgen]
pub fn render_page(pdf: &[u8], page: u32, dpi: f32) -> Result<js_sys::Uint8Array, JsValue> {
    let mut reader = pdfloom_parse::PdfReader::from_bytes(pdf.to_vec())
        .map_err(|e| JsValue::from_str(&format!("parse: {e}")))?;
    let bmp = pdfloom_render::render_page_reader(
        &mut reader,
        page as usize,
        pdfloom_render::RenderOptions {
            dpi: f64::from(dpi),
            white_background: true,
        },
    )
    .map_err(|e| JsValue::from_str(&e))?;
    let png = bmp.to_png().map_err(|e| JsValue::from_str(&e))?;
    Ok(js_sys::Uint8Array::from(&png[..]))
}

/// Retag an existing PDF entirely in the browser: extract the text
/// runs, apply the heuristic auto-tagging (first run per page becomes
/// H1, short all-caps runs become H2, page furniture becomes
/// artifacts), and rebuild it as a freshly tagged, compliant document.
/// `profile` is `"ua1"` or `"ua2"`.
///
/// # Errors
///
/// A `JsString` when the bytes are not a parsable PDF or the rebuild
/// fails.
#[allow(clippy::needless_pass_by_value)]
#[wasm_bindgen]
pub fn retag(
    pdf: &[u8],
    fonts: &FontBundle,
    title: &str,
    lang: &str,
    profile: &str,
) -> Result<BuildOutput, JsValue> {
    if fonts.is_empty() {
        return Err(JsValue::from_str(
            "FontBundle is empty: register at least Liberation Sans Regular before retagging",
        ));
    }
    let mut session = pdfloom::TagSession::from_bytes(pdf.to_vec())
        .map_err(|e| JsValue::from_str(&format!("open: {e}")))?;
    session.auto_tag();
    let profile = if profile.eq_ignore_ascii_case("ua2") {
        pdfloom::Profile::PdfUa2
    } else {
        pdfloom::Profile::PdfUa1
    };
    let (bytes, report) = session
        .build_with(profile, title, lang, |doc| {
            for (family, style, data) in &fonts.entries {
                doc.register_font_bytes(family, style, data.clone());
            }
        })
        .map_err(|e| JsValue::from_str(&format!("retag: {e}")))?;
    Ok(BuildOutput {
        pdf: bytes,
        report: report_json(&report),
    })
}
