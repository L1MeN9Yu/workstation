use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::{
    cmux_config_path, ghosty_config_path,
    ghosty_remote::{parse_ghosty_keys_html, GhostyRemoteKey},
    iterm2::{
        delete_iterm2_profile_at, iterm2_profiles_dir, list_iterm2_profiles_at, reload_iterm2_impl,
        write_iterm2_profile_at, Iterm2ProfileFile, Iterm2ReloadStatus,
    },
    iterm2_remote::{
        merge_remote_keys, parse_iterm2_keys_html, parse_profile_model_keys, Iterm2RemoteKey,
    },
    read_cmux_config_at, read_config as read_config_impl, read_ghosty_config_at,
    reload_cmux_config_impl,
    wallpaper::{self, SearchQuery, SourceSettings, ThumbState, WallpaperItem, WallpaperSettings},
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
pub async fn fetch_ghosty_keys() -> Result<Vec<GhostyRemoteKey>, String> {
    let html = reqwest::get("https://ghostty.org/docs/config/reference")
        .await
        .map_err(|e| format!("fetch ghosty keys failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read ghosty keys failed: {e}"))?;
    Ok(parse_ghosty_keys_html(&html))
}

#[tauri::command]
pub async fn fetch_iterm2_keys() -> Vec<Iterm2RemoteKey> {
    let mut sources: Vec<Vec<Iterm2RemoteKey>> = Vec::new();
    if let Ok(resp) = reqwest::get("https://iterm2.com/documentation-dynamic-profiles.html").await {
        if let Ok(html) = resp.text().await {
            sources.push(parse_iterm2_keys_html(&html));
        }
    }
    if let Ok(resp) = reqwest::get(
        "https://raw.githubusercontent.com/gnachman/iTerm2/master/sources/ProfileModel.m",
    )
    .await
    {
        if let Ok(src) = resp.text().await {
            sources.push(parse_profile_model_keys(&src));
        }
    }
    merge_remote_keys(sources)
}

#[tauri::command]
pub async fn list_system_fonts(app: AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app.state::<crate::fonts::FontCache>();
        let cache = &cache.0;
        crate::fonts::list_font_families_cached(cache, || {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            db.faces().cloned().collect()
        })
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn reload_cmux_config() -> Result<CmuxReloadStatus, String> {
    reload_cmux_config_impl()
}

#[tauri::command]
pub fn list_iterm2_profiles() -> Result<Vec<Iterm2ProfileFile>, String> {
    let dir = iterm2_profiles_dir()
        .ok_or_else(|| "cannot resolve iTerm2 DynamicProfiles dir".to_string())?;
    list_iterm2_profiles_at(&dir)
}

#[tauri::command]
pub fn write_iterm2_profile(name: String, content: String) -> Result<(), String> {
    let dir = iterm2_profiles_dir()
        .ok_or_else(|| "cannot resolve iTerm2 DynamicProfiles dir".to_string())?;
    write_iterm2_profile_at(&dir, &name, &content)
}

#[tauri::command]
pub fn delete_iterm2_profile(name: String) -> Result<(), String> {
    let dir = iterm2_profiles_dir()
        .ok_or_else(|| "cannot resolve iTerm2 DynamicProfiles dir".to_string())?;
    delete_iterm2_profile_at(&dir, &name)
}

#[tauri::command]
pub fn reload_iterm2_config() -> Result<Iterm2ReloadStatus, String> {
    reload_iterm2_impl()
}

fn wallpaper_settings_from_config() -> WallpaperSettings {
    let raw = read_config_impl("wallpaper".to_string());
    let mut settings: WallpaperSettings = match raw {
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
    };
    if let Ok(value) = read_config_impl("wallpaperSources".to_string()) {
        if let Some(sources) = value.get("sources") {
            match serde_json::from_value::<HashMap<String, SourceSettings>>(sources.clone()) {
                Ok(sources) => settings.sources = sources,
                Err(e) => log::error!("wallpaperSources config parse failed: {e}"),
            }
        }
    }
    // 全局代理配置优先：非空走全局代理（reqwest .proxy() 自动禁用系统代理），
    // 为空则直连（不再使用壁纸旧默认代理）。
    settings.proxy = read_global_proxy();
    settings
}

/// 读取全局代理配置 `proxy.json` 的 `proxy` 字段；缺失/解析失败/空串返回 None（直连）。
fn read_global_proxy() -> Option<String> {
    let raw = read_config_impl("proxy".to_string());
    match raw {
        Ok(value) => match value.get("proxy").and_then(serde_json::Value::as_str) {
            Some(p) if !p.trim().is_empty() => Some(p.trim().to_string()),
            _ => None,
        },
        Err(e) => {
            log::warn!("global proxy config read failed: {e}");
            None
        }
    }
}

#[tauri::command]
pub async fn search_wallpapers(
    app: AppHandle,
    query: SearchQuery,
    settings: Option<WallpaperSettings>,
) -> Result<Vec<WallpaperItem>, String> {
    let settings = settings.unwrap_or_else(wallpaper_settings_from_config);
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

#[tauri::command]
pub async fn fetch_full_image(item: WallpaperItem) -> Result<String, String> {
    let (bytes, mime) = wallpaper::fetch_full_image(item, wallpaper_settings_from_config()).await?;
    Ok(wallpaper::full_image_data_url(&bytes, &mime))
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("cannot resolve app log dir: {e}"))?;
    tauri_plugin_opener::open_path(dir, None::<&str>)
        .map_err(|e| format!("cannot open log dir: {e}"))
}

fn log_dir_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| format!("cannot resolve app log dir: {e}"))
}

/// 初始化应用日志：写入平台日志目录的 `workstation.log`（含启动归档与清理），
/// 同时输出到控制台。文件初始化失败时降级为仅控制台输出，不导致应用崩溃。
fn init_logging(app: &tauri::App) -> Result<(), String> {
    crate::logging::init_logging_with_fallbacks(
        log_dir_path(app.handle()),
        |dir, level| {
            crate::logging::init_file_logging(dir, level, |config| {
                log4rs::init_config(config)
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            })
        },
        |level| {
            log4rs::init_config(crate::logging::build_console_config(level))
                .map(|_| ())
                .map_err(|e| e.to_string())
        },
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let _ = init_logging(app);
            app.listen("frontend-log", move |event| {
                crate::logging::log_frontend_event(event.payload());
            });
            let cache_dir = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("cannot resolve app cache dir: {e}"))?
                .join("wallpapers")
                .join("thumbs");
            fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("cannot create thumb cache dir: {e}"))?;
            app.manage(ThumbState::new(cache_dir));
            app.manage(crate::fonts::FontCache::default());
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
            fetch_ghosty_keys,
            fetch_iterm2_keys,
            list_system_fonts,
            list_iterm2_profiles,
            write_iterm2_profile,
            delete_iterm2_profile,
            reload_iterm2_config,
            search_wallpapers,
            download_wallpaper,
            fetch_full_image,
            open_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
