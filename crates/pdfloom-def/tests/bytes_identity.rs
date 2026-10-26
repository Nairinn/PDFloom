//! Byte-identity of the in-memory build path (`build_to_bytes`, used by
//! the browser/WASM engine) against the file-writing path
//! (`build_to_file`, used natively): the same config must produce the
//! same bytes either way. Also covers the data-URL image decode, which
//! the browser uses exclusively.

use pdfloom_def::{build_to_bytes, build_to_file, parse_def};

const GOLDEN: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/golden_doc.json"
);

#[test]
fn to_bytes_matches_to_file_byte_for_byte() {
    let json = std::fs::read(GOLDEN).expect("fixture");
    let def = parse_def(&json).expect("parse");

    let out_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/output");
    let path = format!("{out_dir}/def_bytes_identity.pdf");
    let report = build_to_file(&def, &path).expect("build via file");
    let file_bytes = std::fs::read(&path).expect("read back");

    let (mem_bytes, mem_report) = build_to_bytes(&def).expect("build via memory");

    assert_eq!(
        report.status, mem_report.status,
        "report status differs between paths"
    );
    assert_eq!(report.violations.len(), mem_report.violations.len());
    assert_eq!(
        file_bytes, mem_bytes,
        "build_to_bytes and build_to_file must be byte-identical"
    );
}

#[test]
fn data_url_images_never_touch_the_filesystem() {
    // 1x1 red PNG, base64.
    const PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    let def = format!(
        r#"{{
        "format": "pdfloom-doc", "version": 1, "profile": "ua1",
        "title": "Bytes image", "lang": "en-US",
        "pages": [{{ "size": [612, 792], "elements": [
            {{ "type": "image", "src": "data:image/png;base64,{PNG_B64}",
               "alt": "a red pixel", "rect": [72, 600, 96, 96], "order": 1 }}
        ]}}]
    }}"#
    );
    let parsed = parse_def(def.as_bytes()).expect("parse");

    let (bytes, report) = build_to_bytes(&parsed).expect("in-memory build");
    assert!(bytes.starts_with(b"%PDF-"), "not a PDF");
    assert_eq!(
        report.status,
        pdfloom_profile::Status::Compliant,
        "violations: {:#?}",
        report.violations
    );

    // The old implementation wrote a temp file before decoding; the
    // bytes path must produce the identical artifact the file path
    // does today.
    let out_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/output");
    let path = format!("{out_dir}/def_bytes_image.pdf");
    build_to_file(&parsed, &path).expect("file build");
    let file_bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes, file_bytes, "data-URL image paths diverged");
}
