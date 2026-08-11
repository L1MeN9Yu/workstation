use tauri::AppHandle;

use crate::{
    cmux_config_path, ghosty_config_path, read_cmux_config_at, read_config as read_config_impl,
    read_ghosty_config_at, reload_cmux_config_impl,
    wallpaper::{self, SearchQuery, WallpaperItem, WallpaperSettings},
    write_cmux_config_at, write_config as write_config_impl, write_ghosty_config_at,
    CmuxConfigFile, CmuxReloadStatus,
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

#[tauri::command]
pub fn write_cmux_config(content: String) -> Result<(), String> {
    let path = cmux_config_path().ok_or_else(|| "cannot resolve cmux config dir".to_string())?;
    write_cmux_config_at(&path, &content)
}

#[tauri::command]
pub fn write_ghosty_config(content: String) -> Result<(), String> {
    let path = ghosty_config_path().ok_or_else(|| "ghosty config file not found".to_string())?;
    write_ghosty_config_at(&path, &content)
}

#[tauri::command]
pub fn reload_cmux_config() -> Result<CmuxReloadStatus, String> {
    reload_cmux_config_impl()
}

fn wallpaper_settings_from_config() -> WallpaperSettings {
    let raw = read_config_impl("wallpaper".to_string());
    match raw {
        Ok(value) => {
            log::debug!("wallpaper config raw: {value}");
            match serde_json::from_value::<WallpaperSettings>(value) {
                Ok(settings) => {
                    log::debug!(
                        "wallpaper config parsed: proxy={:?} download_dir={:?} sources={}",
                        settings.proxy,
                        settings.download_dir,
                        settings.sources.len()
                    );
                    settings
                }
                Err(e) => {
                    log::error!("wallpaper config parse failed: {e}, falling back to defaults");
                    WallpaperSettings::default()
                }
            }
        }
        Err(e) => {
            log::warn!("wallpaper config read failed: {e}, falling back to defaults");
            WallpaperSettings::default()
        }
    }
}

#[tauri::command]
pub async fn search_wallpapers(query: SearchQuery) -> Result<Vec<WallpaperItem>, String> {
    wallpaper::search_wallpapers(query, wallpaper_settings_from_config()).await
}

#[tauri::command]
pub async fn download_wallpaper(item: WallpaperItem) -> Result<String, String> {
    wallpaper::download_wallpaper(item, wallpaper_settings_from_config()).await
}

#[tauri::command]
pub async fn fetch_remote_image(url: String) -> Result<String, String> {
    wallpaper::fetch_thumb_image(url, wallpaper_settings_from_config()).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            app_version,
            read_cmux_config,
            read_ghosty_config,
            write_cmux_config,
            write_ghosty_config,
            reload_cmux_config,
            search_wallpapers,
            download_wallpaper,
            fetch_remote_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
