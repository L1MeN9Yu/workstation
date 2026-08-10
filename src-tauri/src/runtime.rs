use tauri::AppHandle;

use crate::{
    cmux_config_path, ghosty_config_path, read_cmux_config_at, read_config as read_config_impl,
    read_ghosty_config_at, write_config as write_config_impl, CmuxConfigFile,
};

#[tauri::command]
pub fn read_config(key: String) -> Result<serde_json::Value, String> {
    read_config_impl(key)
}

#[tauri::command]
pub fn write_config(key: String, value: serde_json::Value) -> Result<(), String> {
    write_config_impl(key, value)
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn read_cmux_config() -> Result<CmuxConfigFile, String> {
    let path = cmux_config_path().ok_or_else(|| "cannot resolve cmux config dir".to_string())?;
    read_cmux_config_at(&path)
}

#[tauri::command]
pub fn read_ghosty_config() -> Result<CmuxConfigFile, String> {
    let path = ghosty_config_path().ok_or_else(|| "ghosty config file not found".to_string())?;
    read_ghosty_config_at(&path)
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
