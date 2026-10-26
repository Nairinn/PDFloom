//! On-demand CJK font installation (`pdfloom fonts install cjk`).
//!
//! The two Noto Sans CJK JP faces are 16 MB each — far too large to
//! embed — so they are fetched only when a document needs them, never
//! during a build or a save. The downloads are verified against the
//! SHA-256 hashes compiled into this binary and stored in the per-user
//! font cache (see [`FontRegistry::cache_dir`]); the registry checks
//! that cache tier after the embedded fonts and before system fonts.
//!
//! The transport is `curl` (the same tool `scripts/fetch-cjk-fonts.sh`
//! uses): no HTTP stack enters the dependency tree, and the licenses
//! stay permissive-only. Two sources are supported:
//!
//! * the default: the notofonts release the vendored faces came from
//! * `base_url`: a PDFloom Studio deploy serving `/fonts-manifest.json`
//!   plus its content-hashed `/fonts/<hash>/...` paths, so an install
//!   can come from our own Workers site. Manifest hashes are checked
//!   against the compiled-in SHA-256 either way.
//!
//! This module only exists under the `cjk-install` feature.

use sha2::{Digest, Sha256};

/// One installable face: file name and its expected SHA-256.
#[derive(Debug, Clone)]
pub struct CjkFace {
    /// File name inside the cache dir (and the vendored tree).
    pub name: &'static str,
    /// SHA-256 of the file bytes, compiled in.
    pub sha256: &'static str,
    /// Download URL (notofonts release, matching the vendored files).
    pub url: &'static str,
}

/// The two optional CJK faces. Hashes pin the exact bytes the vendored
/// tree ships; any upstream change fails verification loudly instead of
/// silently embedding different glyphs.
pub const CJK_FACES: &[CjkFace] = &[
    CjkFace {
        name: "NotoSansCJKjp-Regular.otf",
        sha256: "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5",
        url: "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf",
    },
    CjkFace {
        name: "NotoSansCJKjp-Bold.otf",
        sha256: "e53dcb0dcb2922e45d01aae1ebd2f382bb81d4229b18b6b883bd170678af1f76",
        url: "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf",
    },
];

/// What an install did.
#[derive(Debug, Clone)]
pub struct CjkInstallReport {
    /// The cache directory the faces now live in.
    pub cache_dir: String,
    /// Faces that were already present (hash-verified earlier).
    pub already_present: Vec<String>,
    /// Faces downloaded and verified this run.
    pub installed: Vec<String>,
}

/// Fetch the optional CJK faces into the per-user font cache.
///
/// `base_url`, when given, is a PDFloom Studio deploy; its
/// `/fonts-manifest.json` maps the vendored file names to hashed
/// download URLs (and both sides are still hash-checked here).
///
/// # Errors
///
/// A human-readable `String` when there is no cache directory, a face
/// cannot be downloaded, or a download fails SHA-256 verification —
/// a failed download is never left in the cache.
pub fn install_cjk_fonts(base_url: Option<&str>) -> Result<CjkInstallReport, String> {
    let Some(cache) = pdfloom_fonts::FontRegistry::cache_dir() else {
        return Err("no conventional user cache directory on this platform".into());
    };
    std::fs::create_dir_all(&cache).map_err(|e| format!("create cache dir: {e}"))?;

    let mut report = CjkInstallReport {
        cache_dir: cache.display().to_string(),
        already_present: Vec::new(),
        installed: Vec::new(),
    };
    for face in CJK_FACES {
        let out_path = cache.join(face.name);
        if out_path.exists() {
            report.already_present.push(face.name.into());
            continue;
        }
        let url = face_url(face, base_url)?;
        let tmp = cache.join(format!(".{}.part", face.name));
        let status = std::process::Command::new("curl")
            .arg("--fail")
            .arg("--location")
            .arg("--silent")
            .arg("--show-error")
            .arg("--output")
            .arg(&tmp)
            .arg(&url)
            .status()
            .map_err(|e| format!("could not run curl (is it installed?): {e}"))?;
        if !status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("download failed for {}", face.name));
        }
        let bytes = std::fs::read(&tmp).map_err(|e| format!("read download: {e}"))?;
        let got = Sha256::digest(&bytes);
        if hex(&got) != face.sha256 {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "SHA-256 mismatch for {}: expected {}, got {}\n\
                 the file was NOT installed",
                face.name,
                face.sha256,
                hex(&got)
            ));
        }
        std::fs::write(&out_path, &bytes).map_err(|e| format!("write cache: {e}"))?;
        let _ = std::fs::remove_file(&tmp);
        report.installed.push(face.name.into());
    }
    Ok(report)
}

/// Resolve the download URL for one face.
fn face_url(face: &CjkFace, base_url: Option<&str>) -> Result<String, String> {
    let Some(base) = base_url else {
        return Ok(face.url.to_string());
    };
    let base = base.trim_end_matches('/');
    let manifest: serde_json::Value = {
        let out = std::process::Command::new("curl")
            .arg("--fail")
            .arg("--silent")
            .arg("--show-error")
            .arg(format!("{base}/fonts-manifest.json"))
            .output()
            .map_err(|e| format!("could not run curl: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "could not read {base}/fonts-manifest.json (is the Studio deploy URL right?)"
            ));
        }
        serde_json::from_slice(&out.stdout).map_err(|e| format!("bad fonts manifest: {e}"))?
    };
    // The manifest lists the hashed URLs for the vendored files; CJK
    // entries may be absent from a default deploy.
    let entries = manifest
        .as_array()
        .ok_or_else(|| "fonts manifest must be an array".to_string())?;
    for e in entries {
        if e["file"] == format!("vendor/noto/{}", face.name) {
            let url = e["url"].as_str().ok_or("manifest entry missing url")?;
            return Ok(if url.starts_with('/') {
                format!("{base}{url}")
            } else {
                url.to_string()
            });
        }
    }
    Err(format!(
        "{} is not in the deploy's fonts manifest (CJK faces are excluded \
         from default deploys; use the notofonts default instead)",
        face.name
    ))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}
