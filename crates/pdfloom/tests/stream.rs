//! Streaming writer end-to-end: a large document flushed page by page,
//! validated by veraPDF out-of-band.

use pdfloom::{Profile, Status, StreamEvent, StreamWriter};

#[test]
fn stream_large_document() {
    let out_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/output");
    let path = format!("{out_dir}/streamed_ua1.pdf");

    let mut w =
        StreamWriter::create(&path, Profile::PdfUa1, "Streamed mega-doc", "en-US").expect("create");

    // Large document: 500 sections in big chunks.
    for s in 0..500 {
        let mut batch = Vec::with_capacity(4);
        batch.push(StreamEvent::Begin {
            tag: if s % 25 == 0 { "H1".into() } else { "P".into() },
            alt: None,
            attrs: None,
        });
        batch.push(StreamEvent::Text {
            text: format!(
                "Section {s}: the quick brown fox jumps over the lazy dog. \
                 This chunk is intentionally long enough to wrap across \
                 several lines so the incremental wrapper is exercised."
            ),
            font: 0,
            size: 11.0,
        });
        batch.push(StreamEvent::End);
        if s % 25 == 0 && s > 0 {
            batch.push(StreamEvent::PageBreak);
        }
        w.push(batch).expect("push");
    }
    let report = w.finish().expect("finish");

    assert_eq!(
        report.status,
        Status::Compliant,
        "violations: {:#?}",
        report.violations
    );
    let meta = std::fs::metadata(&path).unwrap();
    assert!(meta.len() > 100_000, "streamed file looks too small");
}

/// The sink must not influence a single byte: the in-memory writer
/// (browser/WASM path and parity runs) produces exactly what the
/// file-backed writer writes.
#[test]
fn memory_sink_is_byte_identical_to_file_sink() {
    let font_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fonts/vendor/liberation/LiberationSans-Regular.ttf"
    );
    let font = pdfloom::LoadedFont::load(font_path).expect("default font");

    let mut w =
        StreamWriter::create_over(Vec::new(), font, Profile::PdfUa1, "Sink parity", "en-US")
            .expect("create_over");
    let batches = || -> Vec<Vec<StreamEvent>> {
        let mut all = Vec::new();
        for s in 0..40 {
            let mut batch = Vec::with_capacity(4);
            batch.push(StreamEvent::Begin {
                tag: if s % 10 == 0 { "H2".into() } else { "P".into() },
                alt: None,
                attrs: None,
            });
            batch.push(StreamEvent::Text {
                text: format!(
                    "Memory sink section {s} with enough text to wrap at \
                     least once across the frame width."
                ),
                font: 0,
                size: 11.0,
            });
            batch.push(StreamEvent::End);
            if s % 10 == 0 && s > 0 {
                batch.push(StreamEvent::PageBreak);
            }
            all.push(batch);
        }
        all
    };
    for batch in batches() {
        w.push(batch).expect("push");
    }
    let (bytes, report) = w.into_sink().expect("finish");
    assert_eq!(report.status, Status::Compliant);

    let out_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/output");
    let path = format!("{out_dir}/streamed_file_sink.pdf");
    let mut file_w =
        StreamWriter::create(&path, Profile::PdfUa1, "Sink parity", "en-US").expect("create");
    for batch in batches() {
        file_w.push(batch).expect("push");
    }
    file_w.finish().expect("finish");

    let file_bytes = std::fs::read(&path).unwrap();
    assert_eq!(
        bytes, file_bytes,
        "in-memory stream output differs from the file sink"
    );
}
