//! Embedded fonts for PDFloom, so `cargo add pdfloom` produces fully
//! shaped documents on a machine with no fonts installed.
//!
//! The crate physically carries the vendored OFL faces (everything
//! except the two Noto CJK JP files, which are fetched on demand by
//! `pdfloom fonts install cjk`). The sources in this repo are relative
//! symlinks to `fonts/vendor/`; `cargo package` follows them, so the
//! published crate contains the font bytes and their OFL license texts.
//!
//! PDFloom pulls this in through its default `bundled-fonts` feature
//! and registers the catalog into its font registry's embedded tier;
//! documents can still reference system fonts by name, and explicit
//! developer overrides keep winning (see the pdfloom-fonts resolution
//! order). The crate itself carries no dependencies: it is pure data.
//!
//! # Examples
//!
//! ```no_run
//! let (family, style, bytes) = (
//!     pdfloom_fonts_data::CATALOG[0].family,
//!     pdfloom_fonts_data::CATALOG[0].style,
//!     pdfloom_fonts_data::CATALOG[0].bytes,
//! );
//! # let _ = (family, style, bytes);
//! ```

mod catalog;

pub use catalog::{EmbeddedFont, CATALOG, LICENSES};

/// Number of embedded faces.
#[must_use]
pub fn len() -> usize {
    CATALOG.len()
}

/// True when no face is embedded (never, at this size; symmetry).
#[must_use]
pub fn is_empty() -> bool {
    CATALOG.is_empty()
}
