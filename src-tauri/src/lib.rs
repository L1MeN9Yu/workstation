use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::AppHandle;

fn config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|d| d.join("workstation"))
        .ok_or_else(|| "cannot resolve config directory".to_string())
}

fn config_path(key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.contains("..") || key.contains('/') || key.contains('\\') {
        return Err("invalid config key".to_string());
    }
    Ok(config_dir()?.join(format!("{key}.json")))
}

#[tauri::command]
fn read_config(key: String) -> Result<Value, String> {
    let path = config_path(&key)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_config(key: String, value: Value) -> Result<(), String> {
    let path = config_path(&key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
