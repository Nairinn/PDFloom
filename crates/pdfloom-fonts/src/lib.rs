//! # pdfloom-fonts
//!
//! The font registry: resolve font families by name, with three sources:
//!
//! 1. **Built-in catalog** — free fonts shipped in the crate (Liberation
//!    family now; more groups get their own `pdfloom-fonts-*` crates).
//! 2. **System fonts** — fonts installed on the machine (macOS, Windows,
//!    Linux fontconfig paths), so licensed fonts the user owns work by name.
//! 3. **User-registered fonts** — explicit paths added by the caller.
//!
//! The standard-14 names (`Helvetica`, `Times-Roman`, `Courier`) resolve
//! to Liberation look-alikes, since PDF/UA requires embedded fonts and the
//! standard 14 are never embedded.

use pdfloom_font::LoadedFont;
use std::collections::HashMap;
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;
use std::path::PathBuf;

/// One catalog entry: where to find the file and how to describe it.
#[derive(Debug, Clone)]
pub struct CatalogEntry {
    /// Family name callers use, e.g. `Liberation Sans`.
    pub family: &'static str,
    /// Style: `Regular`, `Bold`, `Italic`, `Bold Italic`.
    pub style: &'static str,
    /// Path relative to this crate's `fonts/` directory.
    pub file: &'static str,
}

/// The built-in catalog (Liberation + Noto families, all OFL-1.1).
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        family: "Liberation Sans",
        style: "Regular",
        file: "vendor/liberation/LiberationSans-Regular.ttf",
    },
    CatalogEntry {
        family: "Liberation Sans",
        style: "Bold",
        file: "vendor/liberation/LiberationSans-Bold.ttf",
    },
    CatalogEntry {
        family: "Liberation Sans",
        style: "Italic",
        file: "vendor/liberation/LiberationSans-Italic.ttf",
    },
    CatalogEntry {
        family: "Liberation Sans",
        style: "Bold Italic",
        file: "vendor/liberation/LiberationSans-BoldItalic.ttf",
    },
    CatalogEntry {
        family: "Liberation Serif",
        style: "Regular",
        file: "vendor/liberation/LiberationSerif-Regular.ttf",
    },
    CatalogEntry {
        family: "Liberation Serif",
        style: "Bold",
        file: "vendor/liberation/LiberationSerif-Bold.ttf",
    },
    CatalogEntry {
        family: "Liberation Serif",
        style: "Italic",
        file: "vendor/liberation/LiberationSerif-Italic.ttf",
    },
    CatalogEntry {
        family: "Liberation Serif",
        style: "Bold Italic",
        file: "vendor/liberation/LiberationSerif-BoldItalic.ttf",
    },
    CatalogEntry {
        family: "Liberation Mono",
        style: "Regular",
        file: "vendor/liberation/LiberationMono-Regular.ttf",
    },
    CatalogEntry {
        family: "Liberation Mono",
        style: "Bold",
        file: "vendor/liberation/LiberationMono-Bold.ttf",
    },
    CatalogEntry {
        family: "Liberation Mono",
        style: "Italic",
        file: "vendor/liberation/LiberationMono-Italic.ttf",
    },
    CatalogEntry {
        family: "Liberation Mono",
        style: "Bold Italic",
        file: "vendor/liberation/LiberationMono-BoldItalic.ttf",
    },
    CatalogEntry {
        family: "Noto Sans",
        style: "Regular",
        file: "vendor/noto/NotoSans-Regular.ttf",
    },
    CatalogEntry {
        family: "Noto Sans",
        style: "Bold",
        file: "vendor/noto/NotoSans-Bold.ttf",
    },
    CatalogEntry {
        family: "Noto Sans",
        style: "Italic",
        file: "vendor/noto/NotoSans-Italic.ttf",
    },
    CatalogEntry {
        family: "Noto Sans",
        style: "Bold Italic",
        file: "vendor/noto/NotoSans-BoldItalic.ttf",
    },
    CatalogEntry {
        family: "Noto Serif",
        style: "Regular",
        file: "vendor/noto/NotoSerif-Regular.ttf",
    },
    CatalogEntry {
        family: "Noto Serif",
        style: "Bold",
        file: "vendor/noto/NotoSerif-Bold.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Mono",
        style: "Regular",
        file: "vendor/noto/NotoSansMono-Regular.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Mono",
        style: "Bold",
        file: "vendor/noto/NotoSansMono-Bold.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Myanmar",
        style: "Regular",
        file: "vendor/noto/NotoSansMyanmar-Regular.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Myanmar",
        style: "Bold",
        file: "vendor/noto/NotoSansMyanmar-Bold.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Thai",
        style: "Regular",
        file: "vendor/noto/NotoSansThai-Regular.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Thai",
        style: "Bold",
        file: "vendor/noto/NotoSansThai-Bold.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Arabic",
        style: "Regular",
        file: "vendor/noto/NotoSansArabic-Regular.ttf",
    },
    CatalogEntry {
        family: "Noto Sans Arabic",
        style: "Bold",
        file: "vendor/noto/NotoSansArabic-Bold.ttf",
    },
    CatalogEntry {
        family: "Noto Sans CJK JP",
        style: "Regular",
        file: "vendor/noto/NotoSansCJKjp-Regular.otf",
    },
    CatalogEntry {
        family: "Noto Sans CJK JP",
        style: "Bold",
        file: "vendor/noto/NotoSansCJKjp-Bold.otf",
    },
    CatalogEntry {
        family: "Atkinson Hyperlegible",
        style: "Regular",
        file: "vendor/accessibility/AtkinsonHyperlegible-Regular.ttf",
    },
    CatalogEntry {
        family: "Atkinson Hyperlegible",
        style: "Bold",
        file: "vendor/accessibility/AtkinsonHyperlegible-Bold.ttf",
    },
    CatalogEntry {
        family: "OpenDyslexic",
        style: "Regular",
        file: "vendor/accessibility/OpenDyslexic-Regular.otf",
    },
    CatalogEntry {
        family: "OpenDyslexic",
        style: "Bold",
        file: "vendor/accessibility/OpenDyslexic-Bold.otf",
    },
];

/// Standard-14 name → look-alike family (PDF/UA needs embedded fonts).
/// (alias, look-alike family, style the alias implies).
const STANDARD_14: &[(&str, &str, &str)] = &[
    ("Helvetica", "Liberation Sans", "regular"),
    ("Helvetica-Bold", "Liberation Sans", "bold"),
    ("Helvetica-Oblique", "Liberation Sans", "italic"),
    ("Helvetica-BoldOblique", "Liberation Sans", "bold italic"),
    ("Arial", "Liberation Sans", "regular"),
    ("Times-Roman", "Liberation Serif", "regular"),
    ("Times-Bold", "Liberation Serif", "bold"),
    ("Times-Italic", "Liberation Serif", "italic"),
    ("Times-BoldItalic", "Liberation Serif", "bold italic"),
    ("Times New Roman", "Liberation Serif", "regular"),
    ("Courier", "Liberation Mono", "regular"),
    ("Courier-Bold", "Liberation Mono", "bold"),
    ("Courier-Oblique", "Liberation Mono", "italic"),
    ("Courier-BoldOblique", "Liberation Mono", "bold italic"),
    ("Courier New", "Liberation Mono", "regular"),
];

/// Resolve a standard-14 / common name to its look-alike family.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn standard14_family(name: &str) -> Option<(&'static str, &'static str)> {
    STANDARD_14
        .iter()
        .find(|(alias, _, _)| eq_ignore_case(alias, name))
        .map(|(_, family, style)| (*family, *style))
}

fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// The resolved location of a font file: either a path (native) or the
/// in-memory bytes a caller registered (browser/WASM).
#[derive(Debug, Clone)]
pub struct Resolved {
    /// Absolute path of the font file (empty when `bytes` is set).
    pub path: PathBuf,
    /// In-memory font bytes, when this was registered from a byte
    /// source (browser/WASM path; mutually exclusive with `path`).
    pub bytes: Option<Vec<u8>>,
    /// Family that was matched.
    pub family: String,
    /// True when this is a look-alike substitution (name not found).
    pub substituted: bool,
}

/// Errors from the registry.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    /// No font matched and no fallback could be loaded.
    #[error("no font found for {0:?}")]
    NotFound(String),
}

/// The registry: name → file resolution over catalog + system + user fonts.
#[derive(Debug, Default)]
pub struct FontRegistry {
    /// User-registered in-memory fonts (browser/WASM): family name
    /// (lowercased) → bytes by style. Checked before everything else.
    bytes: HashMap<String, HashMap<String, Vec<u8>>>,
    /// Fonts embedded by pdfloom-fonts-data (the `bundled-fonts`
    /// tier): family (lowercased) → bytes by style. Checked after the
    /// env/repo fonts_dir catalog, before any system lookup.
    embedded: HashMap<String, HashMap<String, &'static [u8]>>,
    /// User-registered: family name (lowercased) → paths by style.
    user: HashMap<String, HashMap<String, PathBuf>>,
    /// System scan cache: family → paths by style.
    system: Option<HashMap<String, HashMap<String, PathBuf>>>,
    /// Downloaded-font cache scan (the `fonts install` tier), same
    /// shape as the system scan; probed lazily once.
    cache: Option<HashMap<String, HashMap<String, PathBuf>>>,
}

impl FontRegistry {
    /// Debug/testing accessor: the scanned system font map, if any.
    #[must_use]
    pub fn system_scan(&self) -> &HashMap<String, HashMap<String, PathBuf>> {
        static EMPTY: std::sync::OnceLock<HashMap<String, HashMap<String, PathBuf>>> =
            std::sync::OnceLock::new();
        self.system
            .as_ref()
            .unwrap_or_else(|| EMPTY.get_or_init(HashMap::new))
    }

    /// New empty registry (no system scan yet).
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a font file under a family name.
    pub fn register(&mut self, family: &str, style: &str, path: impl Into<PathBuf>) {
        self.user
            .entry(family.to_ascii_lowercase())
            .or_default()
            .insert(style.to_ascii_lowercase(), path.into());
    }

    /// Register a font from in-memory bytes (the browser path: the
    /// editor fetches bundled OFL fonts and hands the bytes over).
    /// Byte-registered fonts win over every other source.
    pub fn register_bytes(&mut self, family: &str, style: &str, data: Vec<u8>) {
        self.bytes
            .entry(family.to_ascii_lowercase())
            .or_default()
            .insert(style.to_ascii_lowercase(), data);
    }

    /// Register a font embedded by `pdfloom-fonts-data` (the
    /// `bundled-fonts` tier). Embedded fonts sit between the env/repo
    /// fonts_dir catalog and the system fonts in the resolution order,
    /// so explicit developer overrides still win.
    pub fn register_embedded(&mut self, family: &str, style: &str, data: &'static [u8]) {
        self.embedded
            .entry(family.to_ascii_lowercase())
            .or_default()
            .insert(style.to_ascii_lowercase(), data);
    }

    /// The per-user downloaded-font cache directory (populated by
    /// `pdfloom fonts install cjk`). `None` when the platform has no
    /// conventional cache location.
    #[must_use]
    pub fn cache_dir() -> Option<std::path::PathBuf> {
        static DIR: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
        DIR.get_or_init(|| {
            #[cfg(not(target_arch = "wasm32"))]
            {
                directories::ProjectDirs::from("", "", "pdfloom")
                    .map(|d| d.cache_dir().join("fonts"))
            }
            #[cfg(target_arch = "wasm32")]
            {
                None
            }
        })
        .clone()
    }

    /// Cached fonts directory (the probe runs canonicalize up to 3x per
    /// resolve otherwise). Computed once per process.
    /// Filesystem sources do not exist on wasm32: no env, no repo
    /// checkout, no system fonts — fonts arrive as registered bytes.
    #[cfg(not(target_arch = "wasm32"))]
    fn fonts_dir() -> Option<&'static PathBuf> {
        static DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
        DIR.get_or_init(|| {
            // Runtime relocation: PDFLOOM_FONTS_DIR wins when it names a
            // directory (documented as a runtime env var).
            let mut candidates: Vec<PathBuf> = std::env::var_os("PDFLOOM_FONTS_DIR")
                .map(PathBuf::from)
                .into_iter()
                .chain([
                    // The fonts/ directory lives at the workspace root.
                    // CARGO_MANIFEST_DIR for this crate is
                    // <root>/crates/pdfloom-fonts, so walk up twice.
                    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fonts"),
                    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fonts"),
                    Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts"),
                ])
                .collect();
            candidates.dedup();
            for p in candidates {
                if let Ok(c) = p.canonicalize() {
                    if c.is_dir() {
                        return Some(c);
                    }
                }
            }
            None
        })
        .as_ref()
    }

    /// The wasm32 counterpart: there is no fonts directory.
    #[cfg(target_arch = "wasm32")]
    fn fonts_dir() -> Option<&'static PathBuf> {
        None
    }

    /// Resolve a family+style to a file, checking byte-registered
    /// fonts, then user fonts, then the built-in catalog, then system
    /// fonts.
    pub fn resolve(&mut self, family: &str, style: &str) -> Result<Resolved, RegistryError> {
        let key = family.to_ascii_lowercase();
        let style_key = style.to_ascii_lowercase();

        // 0. Byte-registered fonts (browser/WASM): explicit beats
        // everything, so the editor controls exactly which faces load.
        if let Some(styles) = self.bytes.get(&key) {
            if let Some(data) = styles.get(&style_key).or_else(|| styles.get("regular")) {
                return Ok(Resolved {
                    path: PathBuf::new(),
                    bytes: Some(data.clone()),
                    family: family.to_string(),
                    substituted: false,
                });
            }
        }

        // 1. User-registered.
        if let Some(styles) = self.user.get(&key) {
            if let Some(p) = styles.get(&style_key).or_else(|| styles.get("regular")) {
                return Ok(Resolved {
                    path: p.clone(),
                    bytes: None,
                    family: family.to_string(),
                    substituted: false,
                });
            }
        }

        // 2. Standard-14 alias table (used only if 3 and 4 both miss, so a
        // real system font is preferred over a look-alike).
        let cat_family = standard14_family(family).map(|(f, _)| f.to_ascii_lowercase());

        // 3. Built-in catalog (exact family names like "Liberation Sans").
        if let Some(dir) = Self::fonts_dir() {
            for e in CATALOG {
                if e.family.to_ascii_lowercase() == key {
                    let want = style_key.is_empty()
                        || e.style.to_ascii_lowercase().contains(&style_key)
                        || style_matches(&style_key, e.style);
                    if want {
                        let p = dir.join(e.file);
                        if p.exists() {
                            return Ok(Resolved {
                                path: p,
                                bytes: None,
                                family: e.family.to_string(),
                                substituted: false,
                            });
                        }
                    }
                }
            }
        }

        // 3.5 Embedded fonts (pdfloom-fonts-data / the `bundled-fonts`
        // feature): packaged installs work with no fonts on the machine,
        // but env/repo fonts still win, so developer overrides hold.
        if let Some(styles) = self.embedded.get(&key) {
            if let Some(data) = styles.get(&style_key).or_else(|| styles.get("regular")) {
                return Ok(Resolved {
                    path: PathBuf::new(),
                    bytes: Some(data.to_vec()),
                    family: family.to_string(),
                    substituted: false,
                });
            }
        }

        // 3.6 The per-user downloaded-font cache (`pdfloom fonts install
        // cjk` writes there, SHA-256 verified). Scanned lazily, once.
        if self.cache.is_none() {
            self.cache = Some(scan_dir_by_family(&Self::cache_dir()));
        }
        if let Some(cached) = self.cache.as_ref() {
            if let Some(styles) = cached.get(&key) {
                if let Some(p) = styles
                    .get(&style_key)
                    .or_else(|| styles.get("regular"))
                    .or_else(|| styles.values().next())
                {
                    return Ok(Resolved {
                        path: p.clone(),
                        bytes: None,
                        family: family.to_string(),
                        substituted: false,
                    });
                }
            }
        }

        // 4. System fonts (scan once, cache). A licensed font the user owns
        //    is NOT a substitution.
        if self.system.is_none() {
            self.system = Some(scan_system_fonts());
        }
        if let Some(sys) = self.system.as_ref() {
            if let Some(styles) = sys.get(&key) {
                if let Some(p) = styles
                    .get(&style_key)
                    .or_else(|| styles.get("regular"))
                    .or_else(|| styles.values().next())
                {
                    return Ok(Resolved {
                        path: p.clone(),
                        bytes: None,
                        family: family.to_string(),
                        substituted: false,
                    });
                }
            }
        }

        // 5. Standard-14 alias → catalog look-alike (substituted). The
        // alias itself implies a style ("Helvetica-Bold" is bold) which
        // wins over a generic request; the requested style only refines
        // a plain alias.
        if let Some(aliased) = cat_family.as_deref() {
            let alias_style = standard14_family(family)
                .map(|(_, st)| st.to_string())
                .unwrap_or_default();
            let want_style = if !alias_style.is_empty() && alias_style != "regular" {
                alias_style
            } else {
                style_key.clone()
            };
            if let Some(dir) = Self::fonts_dir() {
                for e in CATALOG {
                    if e.family.to_ascii_lowercase() == aliased
                        && style_matches(&want_style, e.style)
                    {
                        let p = dir.join(e.file);
                        if p.exists() {
                            return Ok(Resolved {
                                path: p,
                                bytes: None,
                                family: e.family.to_string(),
                                substituted: true,
                            });
                        }
                    }
                }
            }
        }

        // 5. Fallback: Liberation Sans Regular (substituted).
        if let Some(dir) = Self::fonts_dir() {
            for e in CATALOG {
                if e.family == "Liberation Sans" && e.style == "Regular" {
                    let p = dir.join(e.file);
                    if p.exists() {
                        return Ok(Resolved {
                            path: p,
                            bytes: None,
                            family: e.family.to_string(),
                            substituted: true,
                        });
                    }
                }
            }
        }

        // 6. Last resort: any system sans-serif (packaged installs have no
        //    bundled fonts; degrade to the platform's default sans with a
        //    substitution note rather than failing).
        if let Some(sys) = self.system.as_ref() {
            for probe in [
                "helvetica",
                "arial",
                "liberation sans",
                "dejavu sans",
                "noto sans",
            ] {
                if let Some(styles) = sys.get(probe) {
                    if let Some(p) = styles.get("regular").or_else(|| styles.values().next()) {
                        return Ok(Resolved {
                            path: p.clone(),
                            bytes: None,
                            family: probe.to_string(),
                            substituted: true,
                        });
                    }
                }
            }
        }

        Err(RegistryError::NotFound(family.to_string()))
    }

    /// Resolve and load in one step. Byte-registered fonts load from
    /// memory; paths load from the filesystem.
    pub fn load(
        &mut self,
        family: &str,
        style: &str,
    ) -> Result<(LoadedFont, Resolved), Box<dyn std::error::Error>> {
        let r = self.resolve(family, style)?;
        let f = if let Some(bytes) = &r.bytes {
            LoadedFont::from_bytes(bytes.clone())?
        } else {
            LoadedFont::load(&r.path)?
        };
        Ok((f, r))
    }
}

/// Index every font file under `dir` (recursively) by family/style
/// from each font's own name table — the downloaded-font cache shape.
/// `None` (no conventional cache dir) yields an empty index.
fn scan_dir_by_family(
    dir: &Option<std::path::PathBuf>,
) -> HashMap<String, HashMap<String, PathBuf>> {
    let mut out: HashMap<String, HashMap<String, PathBuf>> = HashMap::new();
    if let Some(d) = dir {
        #[cfg(not(target_arch = "wasm32"))]
        scan_dir(d, &mut out);
    }
    out
}

/// Scan the platform's font directories for TTF/OTF files, keyed by
/// family name (from the font's own name table) and style. Recurses into
/// subdirectories (macOS keeps fonts in `Supplemental/`, X11 in
/// `truetype/`). Not compiled on wasm32: there are no system fonts in
/// the browser.
#[cfg(not(target_arch = "wasm32"))]
fn scan_system_fonts() -> HashMap<String, HashMap<String, PathBuf>> {
    let mut out: HashMap<String, HashMap<String, PathBuf>> = HashMap::new();
    let roots: Vec<PathBuf> = if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/System/Library/Fonts"),
            PathBuf::from("/Library/Fonts"),
            PathBuf::from("~/Library/Fonts").expand_home(),
        ]
    } else if cfg!(target_os = "windows") {
        vec![PathBuf::from("C:/Windows/Fonts")]
    } else {
        vec![
            PathBuf::from("/usr/share/fonts"),
            PathBuf::from("/usr/local/share/fonts"),
            PathBuf::from("~/.fonts").expand_home(),
            PathBuf::from("~/.local/share/fonts").expand_home(),
        ]
    };
    for root in roots {
        scan_dir(&root, &mut out);
    }
    out
}

/// The wasm32 counterpart: no system font directories exist.
#[cfg(target_arch = "wasm32")]
fn scan_system_fonts() -> HashMap<String, HashMap<String, PathBuf>> {
    HashMap::new()
}

#[cfg(not(target_arch = "wasm32"))]
fn scan_dir(dir: &Path, out: &mut HashMap<String, HashMap<String, PathBuf>>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir(&path, out);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if !matches!(ext.as_str(), "ttf" | "otf") {
            continue;
        }
        if let Ok((family, style)) = pdfloom_font::probe(&path) {
            if family.is_empty() {
                continue;
            }
            out.entry(family.to_ascii_lowercase())
                .or_default()
                .entry(style.to_ascii_lowercase())
                .or_insert(path);
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
trait ExpandHome {
    fn expand_home(self) -> PathBuf;
}

#[cfg(not(target_arch = "wasm32"))]
impl ExpandHome for PathBuf {
    fn expand_home(self) -> PathBuf {
        if let Some(rest) = self.to_str().and_then(|s| s.strip_prefix('~')) {
            if let Some(home) = std::env::var_os("HOME") {
                return Path::new(&home).join(rest.trim_start_matches('/'));
            }
        }
        self
    }
}

/// True when a catalog entry's style satisfies the requested style key
/// ("bold", "italic", "bold italic", "regular", or empty = any).
fn style_matches(want: &str, have: &str) -> bool {
    match want {
        "" | "regular" => have.eq_ignore_ascii_case("regular"),
        "bold" => have.eq_ignore_ascii_case("bold") || have.eq_ignore_ascii_case("bold italic"),
        "italic" => have.eq_ignore_ascii_case("italic") || have.eq_ignore_ascii_case("bold italic"),
        "bold italic" => have.eq_ignore_ascii_case("bold italic"),
        other => have.to_ascii_lowercase().contains(other),
    }
}

#[cfg(test)]
mod embedded_and_cache_tiers {
    use super::FontRegistry;

    #[test]
    fn embedded_tier_resolves_bytes() {
        let mut r = FontRegistry::new();
        r.register_embedded("TestOnly Face", "Regular", b"fake-font-bytes");
        let resolved = r
            .resolve("TestOnly Face", "Regular")
            .expect("embedded tier");
        assert_eq!(resolved.bytes.as_deref(), Some(&b"fake-font-bytes"[..]));
        assert!(resolved.path.as_os_str().is_empty());
        assert!(!resolved.substituted);
    }

    #[test]
    fn embedded_tier_is_below_explicit_bytes() {
        let mut r = FontRegistry::new();
        r.register_embedded("Face", "Regular", b"embedded");
        r.register_bytes("Face", "Regular", b"explicit".to_vec());
        let resolved = r.resolve("Face", "Regular").expect("resolves");
        assert_eq!(resolved.bytes.as_deref(), Some(&b"explicit"[..]));
    }

    #[test]
    fn cache_dir_scan_finds_fonts() {
        // A temp cache dir with one probe-able TTF (the real Liberation
        // Sans Regular, copied in) must be indexed by family+style.
        let dir = std::env::temp_dir().join(format!(
            "pdfloom-cache-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let src = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fonts/vendor/liberation/LiberationSans-Regular.ttf"
        );
        std::fs::copy(src, dir.join("LiberationSans-Regular.ttf")).unwrap();
        let scanned = super::scan_dir_by_family(&Some(dir.clone()));
        let styles = scanned.get("liberation sans").expect("family indexed");
        assert!(styles.contains_key("regular"), "styles: {styles:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn none_cache_dir_scans_empty() {
        assert!(super::scan_dir_by_family(&None).is_empty());
    }
}
