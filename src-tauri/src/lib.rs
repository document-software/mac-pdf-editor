mod api;
mod pdf;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let pending_for_setup = Arc::clone(&pending);

    tauri::Builder::default()
        .manage(api::ApiState { pending })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            api::start_http_server(app.handle().clone(), pending_for_setup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pdf::read_pdf_bytes,
            pdf::save_pdf_bytes,
            pdf::get_pdf_info,
            pdf::set_pdf_metadata,
            pdf::compress_pdf,
            pdf::compress_pdf_bytes,
            pdf::ocr_page_png,
            api::api_reply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
