use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

static REQ_COUNTER: AtomicU64 = AtomicU64::new(1);

pub type PendingMap = Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>;

pub struct ApiState {
    pub pending: PendingMap,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApiCommandEvent {
    req_id: String,
    action: String,
    payload: Value,
}

#[derive(Deserialize)]
struct CommandBody {
    action: String,
    #[serde(default)]
    payload: Value,
}

#[tauri::command]
pub fn api_reply(state: State<'_, ApiState>, req_id: String, result: Value) -> Result<(), String> {
    if let Ok(mut map) = state.pending.lock() {
        if let Some(tx) = map.remove(&req_id) {
            let _ = tx.send(result);
        }
    }
    Ok(())
}

fn write_http_response(stream: &mut TcpStream, status: &str, body: &Value) {
    let body_str = body.to_string();
    let resp = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body_str.len(),
        body_str
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn dispatch_to_ui(
    app: &AppHandle,
    pending: &PendingMap,
    action: &str,
    payload: Value,
) -> Result<Value, String> {
    let req_id = format!(
        "req-{}",
        REQ_COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    let (tx, rx) = mpsc::channel::<Value>();
    {
        let mut map = pending.lock().map_err(|_| "Lock error".to_string())?;
        map.insert(req_id.clone(), tx);
    }

    app.emit(
        "api-command",
        ApiCommandEvent {
            req_id: req_id.clone(),
            action: action.to_string(),
            payload,
        },
    )
    .map_err(|e| format!("Failed to emit event: {}", e))?;

    match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(val) => Ok(val),
        Err(_) => {
            if let Ok(mut map) = pending.lock() {
                map.remove(&req_id);
            }
            Err("Timeout waiting for UI response".to_string())
        }
    }
}

fn handle_client(mut stream: TcpStream, app: AppHandle, pending: PendingMap) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(stream.try_clone().unwrap());

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
        return;
    }

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        write_http_response(&mut stream, "400 Bad Request", &json!({ "error": "Invalid HTTP request" }));
        return;
    }
    let method = parts[0];
    let path = parts[1];

    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(val) = lower.strip_prefix("content-length:") {
            content_length = val.trim().parse().unwrap_or(0);
        }
    }

    if method == "OPTIONS" {
        write_http_response(&mut stream, "204 No Content", &json!({}));
        return;
    }

    let mut body_bytes = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body_bytes).is_err() {
        write_http_response(&mut stream, "400 Bad Request", &json!({ "error": "Incomplete body" }));
        return;
    }
    let body_json: Value = if body_bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body_bytes).unwrap_or_else(|_| json!({}))
    };

    if method == "GET" && path == "/health" {
        write_http_response(
            &mut stream,
            "200 OK",
            &json!({ "ok": true, "app": "Mac PDF Editor", "version": "0.1.0", "port": 4890 }),
        );
        return;
    }

    let (action, payload) = if method == "GET" && path == "/state" {
        ("get_state".to_string(), json!({}))
    } else if method == "POST" && path == "/command" {
        match serde_json::from_value::<CommandBody>(body_json.clone()) {
            Ok(cmd) => (cmd.action, cmd.payload),
            Err(e) => {
                write_http_response(
                    &mut stream,
                    "400 Bad Request",
                    &json!({ "error": format!("Invalid command body: {}", e) }),
                );
                return;
            }
        }
    } else if method == "POST" {
        let route_action = path.trim_start_matches('/').replace('/', "_");
        (route_action, body_json)
    } else {
        write_http_response(&mut stream, "404 Not Found", &json!({ "error": "Route not found" }));
        return;
    };

    match dispatch_to_ui(&app, &pending, &action, payload) {
        Ok(res) => write_http_response(&mut stream, "200 OK", &res),
        Err(err) => write_http_response(&mut stream, "500 Internal Server Error", &json!({ "error": err })),
    }
}

pub fn start_http_server(app: AppHandle, pending: PendingMap) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:4890") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("Mac PDF Editor HTTP API could not bind 127.0.0.1:4890: {}", e);
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            let app_clone = app.clone();
            let pending_clone = Arc::clone(&pending);
            std::thread::spawn(move || {
                handle_client(stream, app_clone, pending_clone);
            });
        }
    });
}
