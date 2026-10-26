//! Generated from the pdfloom-fonts CATALOG (same family, style and
//! file names); the two Noto CJK JP faces are excluded - they are
//! fetched on demand (`pdfloom fonts install cjk`) instead of being
//! embedded. The font files are relative symlinks to the repo's
//! fonts/vendor tree; cargo package follows them, so the published
//! .crate carries the bytes and their OFL licenses.

/// One embedded face: (family, style, repo-relative file, bytes).
pub struct EmbeddedFont {
    /// Family name callers use, e.g. `Liberation Sans`.
    pub family: &'static str,
    /// Style: `Regular`, `Bold`, `Italic`, `Bold Italic`.
    pub style: &'static str,
    /// Repo-relative file path (for the save-report and debugging).
    pub file: &'static str,
    /// The TrueType bytes.
    pub bytes: &'static [u8],
}

/// Every non-CJK face bundled with the crate.
pub const CATALOG: &[EmbeddedFont] = &[
    EmbeddedFont {
        family: "Liberation Sans",
        style: "Regular",
        file: "vendor/liberation/LiberationSans-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSans-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Sans",
        style: "Bold",
        file: "vendor/liberation/LiberationSans-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSans-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Sans",
        style: "Italic",
        file: "vendor/liberation/LiberationSans-Italic.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSans-Italic.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Sans",
        style: "Bold Italic",
        file: "vendor/liberation/LiberationSans-BoldItalic.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSans-BoldItalic.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Serif",
        style: "Regular",
        file: "vendor/liberation/LiberationSerif-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSerif-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Serif",
        style: "Bold",
        file: "vendor/liberation/LiberationSerif-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSerif-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Serif",
        style: "Italic",
        file: "vendor/liberation/LiberationSerif-Italic.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSerif-Italic.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Serif",
        style: "Bold Italic",
        file: "vendor/liberation/LiberationSerif-BoldItalic.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationSerif-BoldItalic.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Mono",
        style: "Regular",
        file: "vendor/liberation/LiberationMono-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationMono-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Mono",
        style: "Bold",
        file: "vendor/liberation/LiberationMono-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationMono-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Mono",
        style: "Italic",
        file: "vendor/liberation/LiberationMono-Italic.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationMono-Italic.ttf"),
    },
    EmbeddedFont {
        family: "Liberation Mono",
        style: "Bold Italic",
        file: "vendor/liberation/LiberationMono-BoldItalic.ttf",
        bytes: include_bytes!("../fonts/vendor/liberation/LiberationMono-BoldItalic.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans",
        style: "Regular",
        file: "vendor/noto/NotoSans-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSans-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans",
        style: "Bold",
        file: "vendor/noto/NotoSans-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSans-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans",
        style: "Italic",
        file: "vendor/noto/NotoSans-Italic.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSans-Italic.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans",
        style: "Bold Italic",
        file: "vendor/noto/NotoSans-BoldItalic.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSans-BoldItalic.ttf"),
    },
    EmbeddedFont {
        family: "Noto Serif",
        style: "Regular",
        file: "vendor/noto/NotoSerif-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSerif-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Noto Serif",
        style: "Bold",
        file: "vendor/noto/NotoSerif-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSerif-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Mono",
        style: "Regular",
        file: "vendor/noto/NotoSansMono-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansMono-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Mono",
        style: "Bold",
        file: "vendor/noto/NotoSansMono-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansMono-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Myanmar",
        style: "Regular",
        file: "vendor/noto/NotoSansMyanmar-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansMyanmar-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Myanmar",
        style: "Bold",
        file: "vendor/noto/NotoSansMyanmar-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansMyanmar-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Thai",
        style: "Regular",
        file: "vendor/noto/NotoSansThai-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansThai-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Thai",
        style: "Bold",
        file: "vendor/noto/NotoSansThai-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansThai-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Arabic",
        style: "Regular",
        file: "vendor/noto/NotoSansArabic-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansArabic-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Noto Sans Arabic",
        style: "Bold",
        file: "vendor/noto/NotoSansArabic-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/noto/NotoSansArabic-Bold.ttf"),
    },
    EmbeddedFont {
        family: "Atkinson Hyperlegible",
        style: "Regular",
        file: "vendor/accessibility/AtkinsonHyperlegible-Regular.ttf",
        bytes: include_bytes!("../fonts/vendor/accessibility/AtkinsonHyperlegible-Regular.ttf"),
    },
    EmbeddedFont {
        family: "Atkinson Hyperlegible",
        style: "Bold",
        file: "vendor/accessibility/AtkinsonHyperlegible-Bold.ttf",
        bytes: include_bytes!("../fonts/vendor/accessibility/AtkinsonHyperlegible-Bold.ttf"),
    },
    EmbeddedFont {
        family: "OpenDyslexic",
        style: "Regular",
        file: "vendor/accessibility/OpenDyslexic-Regular.otf",
        bytes: include_bytes!("../fonts/vendor/accessibility/OpenDyslexic-Regular.otf"),
    },
    EmbeddedFont {
        family: "OpenDyslexic",
        style: "Bold",
        file: "vendor/accessibility/OpenDyslexic-Bold.otf",
        bytes: include_bytes!("../fonts/vendor/accessibility/OpenDyslexic-Bold.otf"),
    },
];

/// The OFL license texts shipped with the fonts, as (vendor
/// directory, file name, text) triples.
pub const LICENSES: &[(&str, &str, &str)] = &[
    (
        "vendor/accessibility",
        "LICENSE-Atkinson",
        include_str!("../fonts/vendor/accessibility/LICENSE-Atkinson"),
    ),
    (
        "vendor/accessibility",
        "LICENSE-OpenDyslexic",
        include_str!("../fonts/vendor/accessibility/LICENSE-OpenDyslexic"),
    ),
    (
        "vendor/liberation",
        "LICENSE",
        include_str!("../fonts/vendor/liberation/LICENSE"),
    ),
    (
        "vendor/noto",
        "LICENSE",
        include_str!("../fonts/vendor/noto/LICENSE"),
    ),
];
