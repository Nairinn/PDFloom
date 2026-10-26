//! # pdfloom
//!
//! A free, MIT-licensed, from-scratch PDF library with PDF/UA accessibility
//! built in. This facade crate assembles the lower-level crates into a
//! document API:
//!
//! ```no_run
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! use pdfloom::{Document, Profile};
//!
//! let mut doc = Document::new(Profile::PdfUa1);
//! doc.title("Hello").lang("en-US");
//! doc.load_font("/path/to/font.ttf")?;
//!
//! let mut page = doc.add_page(612.0, 792.0);
//! page.heading(1, "Hello, tagged world!")?;
//! page.paragraph("This PDF has a real structure tree.")?;
//!
//! let report = doc.save("hello.pdf")?;
//! println!("{}", report.note().unwrap_or_else(|| "PDF/UA compliant".into()));
//! # Ok(())
//! # }
//! ```

#[cfg(feature = "cjk-install")]
pub mod cjk;
mod document;
mod extract;
mod flow;
pub mod form;
mod html;
mod image;
mod page;
mod retag;
mod stream;
pub mod structure;
mod tounicode;
pub mod wrap;

pub use document::Document;
pub use extract::{extract_text, PageText};
pub use flow::Flow;
pub use form::fill_text_field;
pub use html::{html_file_to_pdf, html_to_pdf, html_to_pdf_profiled, HtmlError};
pub use image::{Image, ImageError, ImageKind};
pub use page::Page;
pub use pdfloom_font::{FontError, LoadedFont};
pub use pdfloom_parse::{ParseError, PdfReader};
pub use pdfloom_profile::{Metadata, Profile, SaveReport, Status, Violation};
pub use retag::{TagSession, TextRun};
pub use stream::{StreamError, StreamEvent, StreamWriter};
pub use structure::Node;

#[cfg(feature = "cjk-install")]
pub use crate::cjk::{install_cjk_fonts, CjkFace, CjkInstallReport};

/// WinAnsi helpers re-exported for callers that encode text themselves.
pub use pdfloom_font::winansi;

/// Re-exports from the core object model, for advanced use.
pub use pdfloom_core::{Dict, Name, Object, PdfString, PdfVersion, Ref, Stream};

/// Register the embedded `pdfloom-fonts-data` catalog into a registry
/// (no-op when the `bundled-fonts` feature is off). `Document::new`
/// does this automatically; the helper is shared with the streaming
/// writer's default-face resolution.
pub fn register_bundled_fonts(registry: &mut pdfloom_fonts::FontRegistry) {
    #[cfg(feature = "bundled-fonts")]
    for f in pdfloom_fonts_data::CATALOG {
        registry.register_embedded(f.family, f.style, f.bytes);
    }
}

/// The default face (Liberation Sans Regular) used for the F0 font
/// resource: the vendored repo path when the checkout has it (dev),
/// otherwise registry resolution, which reaches the embedded
/// bundled-fonts tier, the downloaded-font cache, and the system
/// fonts — in that order.
#[doc(hidden)]
pub fn load_default_font() -> Result<pdfloom_font::LoadedFont, Box<dyn std::error::Error>> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fonts");
    let p = format!("{dir}/vendor/liberation/LiberationSans-Regular.ttf");
    if std::path::Path::new(&p).exists() {
        if let Ok(f) = pdfloom_font::LoadedFont::load(&p) {
            return Ok(f);
        }
    }
    let mut registry = pdfloom_fonts::FontRegistry::new();
    register_bundled_fonts(&mut registry);
    let (f, _) = registry.load("Liberation Sans", "Regular")?;
    Ok(f)
}
