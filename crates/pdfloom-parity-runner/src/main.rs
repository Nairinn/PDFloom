//! The native side of the native-vs-WASM parity fixtures. The parity
//! harness (scripts/wasm-parity.mjs) drives this binary and the WASM
//! engine over the same inputs and byte-compares the outputs:
//!
//!   stream <envelope.json> --out FILE   replay streamed events
//!   make-untagged --out FILE            generate the deterministic
//!                                       untagged input for retag parity
//!   retag <input.pdf> --out FILE --title T --lang L --profile P

use pdfloom::{Profile, StreamEvent, StreamWriter, TagSession};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("stream") => cmd_stream(&args[1..]),
        Some("make-untagged") => cmd_make_untagged(&args[1..]),
        Some("retag") => cmd_retag(&args[1..]),
        _ => {
            eprintln!("usage: pdfloom-parity-runner <stream|make-untagged|retag> ...");
            2
        }
    };
    std::process::exit(code);
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .map(|i| args[i + 1].clone())
}

fn cmd_stream(args: &[String]) -> i32 {
    let Some(envelope_path) = args.first().cloned() else {
        return usage("stream");
    };
    let Some(out) = flag(args, "--out") else {
        return usage("stream");
    };
    let json = match std::fs::read_to_string(&envelope_path) {
        Ok(j) => j,
        Err(e) => return fail(&format!("read {envelope_path}: {e}")),
    };
    let env: serde_json::Value = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => return fail(&format!("parse envelope: {e}")),
    };
    let profile = if env["profile"]
        .as_str()
        .unwrap_or("ua1")
        .eq_ignore_ascii_case("ua2")
    {
        Profile::PdfUa2
    } else {
        Profile::PdfUa1
    };
    let title = env["title"].as_str().unwrap_or("Streamed document");
    let lang = env["lang"].as_str().unwrap_or("en-US");
    let events = match env["events"].as_array() {
        Some(e) => e,
        None => return fail("envelope: events must be an array"),
    };
    let mut w = match StreamWriter::create(&out, profile, title, lang) {
        Ok(w) => w,
        Err(e) => return fail(&format!("create: {e}")),
    };
    for (i, ev) in events.iter().enumerate() {
        let e = match event(ev) {
            Ok(e) => e,
            Err(m) => return fail(&format!("event {i}: {m}")),
        };
        if let Err(e) = w.push(vec![e]) {
            return fail(&format!("push event {i}: {e}"));
        }
    }
    if let Err(e) = w.finish() {
        return fail(&format!("finish: {e}"));
    }
    println!("wrote {out}");
    0
}

/// Map one JSON event object onto a `StreamEvent` (same wire shape the
/// WASM engine parses).
fn event(v: &serde_json::Value) -> Result<StreamEvent, String> {
    let ty = v["type"].as_str().unwrap_or_default();
    match ty {
        "begin" => Ok(StreamEvent::Begin {
            tag: v["tag"].as_str().unwrap_or("P").to_string(),
            alt: v["alt"].as_str().map(str::to_string),
            attrs: v["attrs"].as_object().map(|o| {
                o.iter()
                    .map(|(k, val)| (k.clone(), val.as_str().unwrap_or_default().to_string()))
                    .collect::<Vec<_>>()
            }),
        }),
        "text" => Ok(StreamEvent::Text {
            text: v["text"].as_str().unwrap_or_default().to_string(),
            font: v["font"].as_u64().unwrap_or(0) as usize,
            size: v["size"].as_f64().unwrap_or(11.0),
        }),
        "end" => Ok(StreamEvent::End),
        "pagebreak" => Ok(StreamEvent::PageBreak),
        "image" => Err("image events are not part of the parity fixtures".into()),
        other => Err(format!("unknown event type {other:?}")),
    }
}

/// A tiny, deterministic, UNTAGGED PDF: two text runs, a Type1 base
/// font, no structure tree, no metadata. The retag parity fixture
/// feeds the same bytes to the native TagSession and the WASM retag.
fn cmd_make_untagged(args: &[String]) -> i32 {
    let Some(out) = flag(args, "--out") else {
        return usage("make-untagged");
    };
    let content = b"BT /F1 18 Tf 72 700 Td (Untagged fixture heading) Tj ET\n\
                    BT /F1 11 Tf 72 668 Td (This PDF has no structure tree at all.) Tj ET\n";
    let mut objs: Vec<Vec<u8>> = Vec::new();
    objs.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    objs.push(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec());
    objs.push(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources \
           << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
            .to_vec(),
    );
    objs.push(
        format!("<< /Length {} >>\nstream\n", content.len())
            .into_bytes()
            .into_iter()
            .chain(content.iter().copied().chain(b"endstream".iter().copied()))
            .collect(),
    );
    objs.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec());

    let mut pdf: Vec<u8> = Vec::new();
    pdf.extend_from_slice(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    let mut offsets = [0u64; 6];
    for (i, body) in objs.iter().enumerate() {
        offsets[i + 1] = pdf.len() as u64;
        pdf.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        pdf.extend_from_slice(body);
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref_off = pdf.len() as u64;
    pdf.extend_from_slice(b"xref\n0 6\n0000000000 65535 f \n");
    for &off in &offsets[1..] {
        pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n");
    pdf.extend_from_slice(format!("{xref_off}\n%%EOF\n").as_bytes());
    if let Err(e) = std::fs::write(&out, &pdf) {
        return fail(&format!("write {out}: {e}"));
    }
    println!("wrote {out} ({} bytes, untagged)", pdf.len());
    0
}

fn cmd_retag(args: &[String]) -> i32 {
    let Some(input) = args.first().cloned() else {
        return usage("retag");
    };
    let Some(out) = flag(args, "--out") else {
        return usage("retag");
    };
    let title = flag(args, "--title").unwrap_or_else(|| "Retagged fixture".into());
    let lang = flag(args, "--lang").unwrap_or_else(|| "en-US".into());
    let profile = match flag(args, "--profile").as_deref() {
        Some("ua2") => Profile::PdfUa2,
        _ => Profile::PdfUa1,
    };
    let mut session = match TagSession::open(&input) {
        Ok(s) => s,
        Err(e) => return fail(&format!("open {input}: {e}")),
    };
    session.auto_tag();
    if let Err(e) = session.save(profile, &title, &lang, &out) {
        return fail(&format!("retag save: {e}"));
    }
    println!("wrote {out}");
    0
}

fn usage(cmd: &str) -> i32 {
    eprintln!("pdfloom-parity-runner: bad arguments for {cmd}");
    2
}
fn fail(msg: &str) -> i32 {
    eprintln!("error: {msg}");
    1
}
