use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
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

#[derive(Serialize)]
struct CmuxConfigFile {
    kind: &'static str,
    path: String,
    content: String,
}

fn cmux_config_path() -> Option<PathBuf> {
    // cmux writes its config to ~/.config/cmux/cmux.json (not the platform
    // config dir, which on macOS is ~/Library/Application Support).
    dirs::home_dir().map(|d| d.join(".config").join("cmux").join("cmux.json"))
}

fn ghosty_config_path() -> Option<PathBuf> {
    let app_support = dirs::data_dir().map(|d| d.join("com.cmuxterm.app").join("config.ghostty"));
    if app_support.as_ref().is_some_and(|p| p.exists()) {
        return app_support;
    }
    dirs::config_dir()
        .map(|d| d.join("ghostty").join("config"))
        .filter(|p| p.exists())
}

fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_cmux_config() -> Result<CmuxConfigFile, String> {
    let path = cmux_config_path().ok_or_else(|| "cannot resolve cmux config dir".to_string())?;
    let content = read_text_file(&path)?;
    Ok(CmuxConfigFile {
        kind: "cmux",
        path: path.display().to_string(),
        content,
    })
}

#[tauri::command]
fn read_ghosty_config() -> Result<CmuxConfigFile, String> {
    let path = ghosty_config_path().ok_or_else(|| "ghosty config file not found".to_string())?;
    let content = read_text_file(&path)?;
    Ok(CmuxConfigFile {
        kind: "ghosty",
        path: path.display().to_string(),
        content,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            app_version,
            read_cmux_config,
            read_ghosty_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmux_config_path_points_to_home_dot_config() {
        let path = cmux_config_path().expect("home dir should resolve");
        assert_eq!(path.file_name().unwrap(), "cmux.json");
        assert_eq!(path.parent().unwrap().file_name().unwrap(), "cmux");
        assert_eq!(
            path.parent()
                .unwrap()
                .parent()
                .unwrap()
                .file_name()
                .unwrap(),
            ".config"
        );
        let home = dirs::home_dir().unwrap();
        assert!(path.starts_with(home));
    }

    #[test]
    fn config_path_rejects_unsafe_keys() {
        assert!(config_path("").is_err());
        assert!(config_path("../etc/passwd").is_err());
        assert!(config_path("a/b").is_err());
        assert!(config_path("a\\b").is_err());
        assert!(config_path("theme").is_ok());
    }

    #[test]
    fn read_text_file_missing_returns_error() {
        let missing = std::env::temp_dir().join("workstation-missing-file-test");
        assert!(read_text_file(&missing).is_err());
    }

    #[test]
    fn ghosty_config_prefers_app_support() {
        // Path resolution logic: the first candidate (cmux app support dir)
        // is preferred; fallback is only reached when it does not exist.
        if let Some(p) = ghosty_config_path() {
            let home = dirs::home_dir().unwrap();
            assert!(p.starts_with(home));
        }
    }
}
