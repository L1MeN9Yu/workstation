use std::borrow::Cow;
use std::fs;

use tauri::{AppHandle, Emitter, Manager};

use crate::{
    cmux_config_path, ghosty_config_path, read_cmux_config_at, read_config as read_config_impl,
    read_ghosty_config_at, reload_cmux_config_impl,
    wallpaper::{self, SearchQuery, ThumbState, WallpaperItem, WallpaperSettings},
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
pub async fn search_wallpapers(
    app: AppHandle,
    query: SearchQuery,
) -> Result<Vec<WallpaperItem>, String> {
    let settings = wallpaper_settings_from_config();
    let items = wallpaper::search_wallpapers(query, settings.clone()).await?;
    let state = app.state::<ThumbState>();
    state.register(&items);
    let app_handle = app.clone();
    let prefetch_items = items.clone();
    tauri::async_runtime::spawn(async move {
        for chunk in prefetch_items.chunks(4) {
            let mut tasks = Vec::new();
            for item in chunk {
                let app_handle = app_handle.clone();
                let settings = settings.clone();
                let hash = item.thumb_hash.clone();
                tasks.push(tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<ThumbState>();
                    let _ = state.get_or_fetch(&hash, &settings).await;
                }));
            }
            for task in tasks {
                let _ = task.await;
            }
        }
        let _ = app_handle.emit("thumb-ready", ());
    });
    Ok(items)
}

#[tauri::command]
pub async fn download_wallpaper(item: WallpaperItem) -> Result<String, String> {
    wallpaper::download_wallpaper(item, wallpaper_settings_from_config()).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let cache_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("cannot resolve app cache dir: {e}"))?
                .join("wallpapers")
                .join("thumbs");
            fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("cannot create thumb cache dir: {e}"))?;
            app.manage(ThumbState::new(cache_dir));
            Ok(())
        })
        .register_uri_scheme_protocol("thumb", |webview, request| {
            use tauri::http;
            let app = webview.app_handle();
            let state = app.state::<ThumbState>();
            let uri = request.uri().to_string();
            let hash = uri
                .strip_prefix("thumb://")
                .map(|rest| {
                    rest.split(['?', '#', '/'])
                        .next()
                        .unwrap_or_default()
                        .to_string()
                })
                .unwrap_or_default();
            if let Some((bytes, mime)) = state.cached(&hash) {
                return http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .body(Cow::Owned(bytes))
                    .unwrap_or_else(|_| {
                        http::Response::builder()
                            .status(500)
                            .body(Cow::Borrowed(&b"internal error"[..]))
                            .unwrap()
                    });
            }
            log::info!("thumb miss, deferring to frontend retry: {hash}");
            http::Response::builder()
                .status(404)
                .body(Cow::Borrowed(&b"thumb not ready"[..]))
                .unwrap_or_else(|_| {
                    http::Response::builder()
                        .status(500)
                        .body(Cow::Borrowed(&b"internal error"[..]))
                        .unwrap()
                })
        })
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
            download_wallpaper
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
