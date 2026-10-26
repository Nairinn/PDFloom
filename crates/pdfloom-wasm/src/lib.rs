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

/// Build a streamed document from a JSON envelope, entirely in memory —
/// the browser counterpart of the native streaming writer. The envelope:
/// `{"profile":"ua1", "title":"...", "lang":"en-US", "events":[...]}` where
/// each event is one of
/// `{"type":"begin","tag":"H1","alt":null,"attrs":null}`,
/// `{"type":"text","text":"...","font":0,"size":11.0}`,
/// `{"type":"end"}`, `{"type":"pagebreak"}`.
/// `font` must be 0 (the default face); image events are rejected —
/// embed images through [`build`] with data: URLs instead.
///
/// The bytes this returns are identical to a native
/// `StreamWriter::create` over the same events and fonts (the memory
/// sink is proven byte-identical to the file sink by the native suite).
///
/// # Errors
///
/// A `JsString` describing the parse, font or streaming failure.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn build_stream(envelope_json: &str, fonts: &FontBundle) -> Result<BuildOutput, JsValue> {
    let env: serde_json::Value = serde_json::from_str(envelope_json)
        .map_err(|e| JsValue::from_str(&format!("envelope: {e}")))?;
    let profile = if env["profile"]
        .as_str()
        .unwrap_or("ua1")
        .eq_ignore_ascii_case("ua2")
    {
        pdfloom::Profile::PdfUa2
    } else {
        pdfloom::Profile::PdfUa1
    };
    let title = env["title"].as_str().unwrap_or("Streamed document");
    let lang = env["lang"].as_str().unwrap_or("en-US");
    let events = env["events"]
        .as_array()
        .ok_or_else(|| JsValue::from_str("envelope: events must be an array"))?;

    let default = fonts
        .entries
        .iter()
        .find(|(f, s, _)| {
            f.eq_ignore_ascii_case("Liberation Sans") && s.eq_ignore_ascii_case("Regular")
        })
        .map(|(_, _, d)| d.clone())
        .ok_or_else(|| {
            JsValue::from_str("FontBundle needs Liberation Sans Regular for streaming")
        })?;
    let default = pdfloom::LoadedFont::from_bytes(default)
        .map_err(|e| JsValue::from_str(&format!("default font: {e}")))?;

    let mut writer = pdfloom::StreamWriter::create_over(Vec::new(), default, profile, title, lang)
        .map_err(|e| JsValue::from_str(&format!("stream: {e}")))?;
    for (i, ev) in events.iter().enumerate() {
        let event = stream_event(ev).map_err(|e| JsValue::from_str(&format!("event {i}: {e}")))?;
        writer
            .push(vec![event])
            .map_err(|e| JsValue::from_str(&format!("stream event {i}: {e}")))?;
    }
    let (bytes, report) = writer
        .into_sink()
        .map_err(|e| JsValue::from_str(&format!("stream finish: {e}")))?;
    Ok(BuildOutput {
        pdf: bytes,
        report: report_json(&report),
    })
}

/// Map one JSON event object onto a `StreamEvent`.
fn stream_event(v: &serde_json::Value) -> Result<pdfloom::StreamEvent, String> {
    let ty = v["type"].as_str().unwrap_or_default();
    match ty {
        "begin" => Ok(pdfloom::StreamEvent::Begin {
            tag: v["tag"].as_str().unwrap_or("P").to_string(),
            alt: v["alt"].as_str().map(str::to_string),
            attrs: v["attrs"].as_object().map(|o| {
                o.iter()
                    .map(|(k, val)| (k.clone(), val.as_str().unwrap_or_default().to_string()))
                    .collect::<Vec<_>>()
            }),
        }),
        "text" => {
            let font = v["font"].as_u64().unwrap_or(0) as usize;
            if font != 0 {
                return Err("only font 0 (the default face) can stream in the browser".into());
            }
            Ok(pdfloom::StreamEvent::Text {
                text: v["text"].as_str().unwrap_or_default().to_string(),
                font: 0,
                size: v["size"].as_f64().unwrap_or(11.0),
            })
        }
        "end" => Ok(pdfloom::StreamEvent::End),
        "pagebreak" => Ok(pdfloom::StreamEvent::PageBreak),
        "image" => Err("streaming image events are native-only; embed images \
                        as data: URLs through build()"
            .into()),
        other => Err(format!("unknown event type {other:?}")),
    }
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
