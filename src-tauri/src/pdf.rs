use lopdf::{Dictionary, Document, Object, StringFormat};
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::ipc::{InvokeBody, Request, Response};

fn decode_header_path(req: &Request<'_>) -> Result<String, String> {
    let raw = req
        .headers()
        .get("x-file-path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing x-file-path header".to_string())?;

    // Percent-decode UTF-8 path
    let mut out = Vec::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).map_err(|e| format!("Invalid UTF-8 path: {}", e))
}

fn extract_raw_bytes<'a>(req: &'a Request<'_>) -> Result<&'a [u8], String> {
    match req.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        InvokeBody::Json(_) => Err("Expected raw binary body".to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub page_count: usize,
    pub pdf_version: String,
    pub file_size: u64,
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub creator: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    pub original_size: u64,
    pub compressed_size: u64,
}

fn extract_info_string(doc: &Document, info_dict: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
    let obj = info_dict.get(key).ok()?;
    let resolved = match obj {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    match resolved {
        Object::String(bytes, _) => {
            // Handle UTF-16BE BOM or plain UTF-8/Latin1
            if bytes.starts_with(&[0xFE, 0xFF]) && bytes.len() >= 2 {
                let u16_chars: Vec<u16> = bytes[2..]
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                Some(String::from_utf16_lossy(&u16_chars))
            } else {
                let text = String::from_utf8_lossy(bytes).trim().to_string();
                if text.is_empty() {
                    None
                } else {
                    Some(text)
                }
            }
        }
        _ => None,
    }
}

#[tauri::command]
pub fn read_pdf_bytes(path: String) -> Result<Response, String> {
    let data = fs::read(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))?;
    Ok(Response::new(data))
}

#[tauri::command]
pub fn save_pdf_bytes(request: Request<'_>) -> Result<u64, String> {
    let path = decode_header_path(&request)?;
    let bytes = extract_raw_bytes(&request)?;
    let len = bytes.len() as u64;
    fs::write(&path, bytes).map_err(|e| format!("Failed to save file '{}': {}", path, e))?;
    Ok(len)
}

#[tauri::command]
pub fn get_pdf_info(path: String) -> Result<PdfMetadata, String> {
    let file_size = fs::metadata(&path)
        .map_err(|e| format!("Cannot read file metadata: {}", e))?
        .len();

    let doc = Document::load(&path).map_err(|e| format!("Failed to parse PDF: {}", e))?;
    let page_count = doc.get_pages().len();
    let pdf_version = doc.version.clone();

    let mut title = None;
    let mut author = None;
    let mut subject = None;
    let mut creator = None;

    if let Ok(info_ref) = doc.trailer.get(b"Info") {
        let info_obj = match info_ref {
            Object::Reference(id) => doc.get_object(*id).ok(),
            other => Some(other),
        };
        if let Some(Object::Dictionary(dict)) = info_obj {
            title = extract_info_string(&doc, dict, b"Title");
            author = extract_info_string(&doc, dict, b"Author");
            subject = extract_info_string(&doc, dict, b"Subject");
            creator = extract_info_string(&doc, dict, b"Creator");
        }
    }

    Ok(PdfMetadata {
        page_count,
        pdf_version,
        file_size,
        title,
        author,
        subject,
        creator,
    })
}

#[tauri::command]
pub fn compress_pdf(input_path: String, output_path: String) -> Result<CompressResult, String> {
    let original_size = fs::metadata(&input_path)
        .map_err(|e| format!("Cannot read input file: {}", e))?
        .len();

    let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    doc.prune_objects();
    doc.compress();
    doc.save(&output_path)
        .map_err(|e| format!("Failed to save compressed PDF: {}", e))?;

    let compressed_size = fs::metadata(Path::new(&output_path))
        .map_err(|e| format!("Cannot read output file: {}", e))?
        .len();

    Ok(CompressResult {
        original_size,
        compressed_size,
    })
}

#[tauri::command]
pub fn compress_pdf_bytes(request: Request<'_>) -> Result<CompressResult, String> {
    let output_path = decode_header_path(&request)?;
    let bytes = extract_raw_bytes(&request)?;
    let original_size = bytes.len() as u64;

    let mut doc = Document::load_mem(bytes).map_err(|e| format!("Failed to parse PDF bytes: {}", e))?;
    doc.prune_objects();
    doc.compress();
    doc.save(&output_path)
        .map_err(|e| format!("Failed to save compressed PDF: {}", e))?;

    let compressed_size = fs::metadata(Path::new(&output_path))
        .map_err(|e| format!("Cannot read output file: {}", e))?
        .len();

    Ok(CompressResult {
        original_size,
        compressed_size,
    })
}


#[tauri::command]
pub fn set_pdf_metadata(
    input_path: String,
    output_path: String,
    title: Option<String>,
    author: Option<String>,
    subject: Option<String>,
    creator: Option<String>,
) -> Result<PdfMetadata, String> {
    let mut doc = Document::load(&input_path).map_err(|e| format!("Failed to load PDF: {}", e))?;

    let info_id = if let Ok(Object::Reference(id)) = doc.trailer.get(b"Info") {
        *id
    } else {
        let new_id = doc.add_object(Object::Dictionary(Dictionary::new()));
        doc.trailer.set("Info", Object::Reference(new_id));
        new_id
    };

    if let Ok(Object::Dictionary(dict)) = doc.get_object_mut(info_id) {
        if let Some(t) = title {
            dict.set("Title", Object::String(t.into_bytes(), StringFormat::Literal));
        }
        if let Some(a) = author {
            dict.set("Author", Object::String(a.into_bytes(), StringFormat::Literal));
        }
        if let Some(s) = subject {
            dict.set("Subject", Object::String(s.into_bytes(), StringFormat::Literal));
        }
        if let Some(c) = creator {
            dict.set("Creator", Object::String(c.into_bytes(), StringFormat::Literal));
        }
    }

    doc.save(&output_path)
        .map_err(|e| format!("Failed to save PDF metadata: {}", e))?;

    get_pdf_info(output_path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTextBlock {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub fn ocr_page_png(png_bytes: Vec<u8>) -> Result<Vec<OcrTextBlock>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = png_bytes;
        return Err("Built-in Vision OCR is currently supported on macOS only".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let tmp_path = std::env::temp_dir().join(format!(
            "mac_pdf_ocr_{}.png",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));

        fs::write(&tmp_path, &png_bytes)
            .map_err(|e| format!("Failed to write temp PNG for OCR: {}", e))?;

        let swift_script = r#"
import Foundation
import Vision
import AppKit

let imagePath = CommandLine.arguments[1]
guard let nsImage = NSImage(contentsOfFile: imagePath),
      let tiffData = nsImage.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    print("[]")
    exit(0)
}

var blocks: [[String: Any]] = []
let request = VNRecognizeTextRequest { req, _ in
    guard let results = req.results as? [VNRecognizedTextObservation] else { return }
    for obs in results {
        guard let top = obs.topCandidates(1).first else { continue }
        let box = obs.boundingBox
        blocks.append([
            "text": top.string,
            "x": box.origin.x,
            "y": 1.0 - box.origin.y - box.size.height,
            "width": box.size.width,
            "height": box.size.height
        ])
    }
}
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US", "ru-RU"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])

if let jsonData = try? JSONSerialization.data(withJSONObject: blocks, options: []),
   let jsonStr = String(data: jsonData, encoding: .utf8) {
    print(jsonStr)
} else {
    print("[]")
}
"#;

        let mut child = Command::new("/usr/bin/swift")
            .arg("-")
            .arg(tmp_path.to_string_lossy().as_ref())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to launch Swift Vision OCR: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(swift_script.as_bytes());
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("OCR process failed: {}", e))?;

        let _ = fs::remove_file(&tmp_path);

        if !output.status.success() {
            let err_str = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Vision OCR error: {}", err_str));
        }

        let stdout_str = String::from_utf8_lossy(&output.stdout);
        let parsed: Vec<serde_json::Value> = serde_json::from_str(stdout_str.trim())
            .map_err(|e| format!("Failed to parse OCR output: {}", e))?;

        let blocks = parsed
            .into_iter()
            .filter_map(|v| {
                Some(OcrTextBlock {
                    text: v.get("text")?.as_str()?.to_string(),
                    x: v.get("x")?.as_f64()?,
                    y: v.get("y")?.as_f64()?,
                    width: v.get("width")?.as_f64()?,
                    height: v.get("height")?.as_f64()?,
                })
            })
            .collect();

        Ok(blocks)
    }
}
