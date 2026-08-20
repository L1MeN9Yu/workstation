use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

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
    read_cmux_config_at, read_cmux_setting_impl, read_config as read_config_impl,
    read_ghosty_config_at, reload_cmux_config_impl,
    wallpaper::{
        self, DeleteWallpapersResult, LocalWallpaperInfo, SearchQuery, SourceSettings, ThumbState,
        WallpaperHistoryPage, WallpaperItem, WallpaperSettings,
    },
    write_cmux_config_at, write_cmux_setting_impl, write_config as write_config_impl,
    write_ghosty_config_at, CmuxConfigFile, CmuxReloadStatus, DetectCmuxResult,
};

/// 数据库连接 state：进程级单连接（`Arc<Mutex<Option<Connection>>>` 保证 Send + Sync）。
/// 启动打开失败时存 None，命令返回错误而非崩溃。
pub struct DbState(pub Arc<Mutex<Option<Connection>>>);

impl DbState {
    /// 在阻塞线程内获取连接并执行 `op`；数据库不可用时返回错误。
    async fn with_conn<T>(
        &self,
        op: impl FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String>
    where
        T: Send + 'static,
    {
        let db = self.0.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let guard = db
                .lock()
                .map_err(|e| format!("database lock poisoned: {e}"))?;
            let conn = guard
                .as_ref()
                .ok_or_else(|| "数据库不可用，请检查数据库文件".to_string())?;
            op(conn)
        })
        .await
        .map_err(|e| format!("database task failed: {e}"))?
    }
}

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
pub fn relaunch_app(app: AppHandle) {
    app.restart();
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
pub async fn list_system_fonts(_app: AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::fonts::list_font_families_cached(|| {
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
pub fn read_cmux_setting() -> Result<Option<String>, String> {
    read_cmux_setting_impl()
}

#[tauri::command]
pub fn write_cmux_setting(bin_path: String) -> Result<(), String> {
    write_cmux_setting_impl(&bin_path)
}

#[tauri::command]
pub async fn detect_cmux() -> Result<DetectCmuxResult, String> {
    tauri::async_runtime::spawn_blocking(crate::detect_cmux_impl)
        .await
        .map_err(|e| format!("cmux detect task failed: {e}"))?
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
    // app 级缓存容量优先：读取 appCache.json 的 cacheLimitBytes 覆盖壁纸配置值
    // （运行时值不持久化；app 级未配置时保留壁纸配置旧值兜底）。
    if let Ok(Some(limit)) = get_app_cache_limit() {
        settings.cache_limit_bytes = Some(limit);
    }
    settings
}

/// 读取 app 级缓存容量上限（字节）；配置缺失或解析失败返回 None。
fn get_app_cache_limit() -> Result<Option<u64>, ()> {
    let raw = read_config_impl("appCache".to_string()).map_err(|_| ())?;
    let settings: crate::app_cache::CacheSettings = serde_json::from_value(raw).map_err(|_| ())?;
    Ok(settings.cache_limit_bytes)
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

/// 壁纸缓存池根目录：`<app_cache>/wallpapers`（缩略图 `thumbs/` 与原图 `full/` 的父目录）。
fn wallpaper_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|d| d.join("wallpapers"))
        .map_err(|e| format!("cannot resolve app cache dir: {e}"))
}

/// 将缓存池根目录注入 settings（运行时值，不持久化）。
fn inject_cache_root(app: &AppHandle, mut settings: WallpaperSettings) -> WallpaperSettings {
    if let Ok(root) = wallpaper_cache_root(app) {
        settings.cache_root = Some(root.display().to_string());
    }
    settings
}

/// 判断某张壁纸的原图是否已存在于磁盘缓存（预览打开时据此决定直接展示原图）。
#[tauri::command]
pub fn has_wallpaper_full_cache(app: AppHandle, item: WallpaperItem) -> bool {
    let Ok(root) = wallpaper_cache_root(&app) else {
        return false;
    };
    wallpaper::full_image_cache_get(&root, &wallpaper::thumb_hash(&item.full_url)).is_some()
}

/// 缓存池占用统计（camelCase 序列化供设置页展示）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperCacheStats {
    total_bytes: u64,
    thumb_bytes: u64,
    full_bytes: u64,
    limit_bytes: u64,
}

#[tauri::command]
pub fn get_wallpaper_cache_stats(app: AppHandle) -> WallpaperCacheStats {
    let mut settings = wallpaper_settings_from_config();
    settings = inject_cache_root(&app, settings);
    let root = wallpaper_cache_root(&app).unwrap_or_default();
    let (total_bytes, thumb_bytes, full_bytes) = wallpaper::full_image_cache_size(&root);
    WallpaperCacheStats {
        total_bytes,
        thumb_bytes,
        full_bytes,
        limit_bytes: settings.cache_limit(),
    }
}

/// 读取 app 级缓存配置（`appCache.json` 的 `cacheLimitBytes`）。
#[tauri::command]
pub fn get_cache_settings() -> crate::app_cache::CacheSettings {
    read_config_impl("appCache".to_string())
        .ok()
        .and_then(|value| serde_json::from_value::<crate::app_cache::CacheSettings>(value).ok())
        .unwrap_or_default()
}

/// 保存 app 级缓存配置（`appCache.json` 的 `cacheLimitBytes`）。
#[tauri::command]
pub fn save_cache_settings(settings: crate::app_cache::CacheSettings) -> Result<(), String> {
    let value = serde_json::to_value(&settings).map_err(|e| format!("serialize failed: {e}"))?;
    write_config_impl("appCache".to_string(), value)
}

/// 清空缓存池（仅缓存文件，不影响本地壁纸库与配置）。
#[tauri::command]
pub fn clear_wallpaper_cache(app: AppHandle) -> Result<(), String> {
    let root = wallpaper_cache_root(&app)?;
    wallpaper::clear_wallpaper_cache(&root)
}

/// 查询 app 通用内存缓存统计（各命名空间条目数、总条目数、容量上限、命中/未命中）。
#[tauri::command]
pub fn get_app_cache_stats() -> crate::app_cache::AppCacheStats {
    crate::app_cache::stats()
}

/// 清空 app 通用内存缓存：namespace 为 Some 时仅清指定命名空间，None 时清全部。
#[tauri::command]
pub fn clear_app_cache(namespace: Option<String>) {
    match namespace {
        Some(ns) => crate::app_cache::clear_namespace(&ns),
        None => crate::app_cache::clear_all(),
    }
}

#[tauri::command]
pub async fn search_wallpapers(
    app: AppHandle,
    query: SearchQuery,
    settings: Option<WallpaperSettings>,
) -> Result<Vec<WallpaperItem>, String> {
    let mut settings = settings.unwrap_or_else(wallpaper_settings_from_config);
    settings.apply_global_proxy(read_global_proxy());
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
                    if let Err(e) = state.get_or_fetch(&hash, &settings).await {
                        log::error!("thumb prefetch failed (hash={hash}): {e}");
                    }
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
pub async fn download_wallpaper(app: AppHandle, item: WallpaperItem) -> Result<String, String> {
    let settings = inject_cache_root(&app, wallpaper_settings_from_config());
    wallpaper::download_wallpaper(item, settings).await
}

#[tauri::command]
pub async fn fetch_full_image(app: AppHandle, item: WallpaperItem) -> Result<String, String> {
    let settings = inject_cache_root(&app, wallpaper_settings_from_config());
    let (bytes, mime) = wallpaper::fetch_full_image(item, settings).await?;
    Ok(wallpaper::full_image_data_url(&bytes, &mime))
}

#[tauri::command]
pub async fn list_local_wallpapers(settings: Option<WallpaperSettings>) -> Vec<LocalWallpaperInfo> {
    let dir = wallpaper::wallpapers_dir(&settings.unwrap_or_else(wallpaper_settings_from_config));
    tauri::async_runtime::spawn_blocking(move || {
        wallpaper::list_local_wallpapers_with(&dir, wallpaper::local_wallpaper_entries, |_| None)
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn wallpaper_thumb(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || {
        let (size, modified) = std::fs::metadata(&path_buf)
            .map(|m| {
                let modified_ms = m
                    .modified()
                    .map(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0)
                    })
                    .unwrap_or(0);
                (m.len(), modified_ms)
            })
            .unwrap_or((0, 0));
        wallpaper::cached_thumbnail_data_url(&path_buf, size, modified, 400)
            .ok_or_else(|| "cannot decode wallpaper thumbnail".to_string())
    })
    .await
    .map_err(|e| format!("wallpaper thumb task failed: {e}"))?
}

#[tauri::command]
pub async fn read_local_wallpaper_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        wallpaper::read_local_wallpaper_file(PathBuf::from(path).as_path())
    })
    .await
    .map_err(|e| format!("wallpaper preview task failed: {e}"))?
}

#[tauri::command]
pub fn delete_local_wallpapers(paths: Vec<String>) -> DeleteWallpapersResult {
    wallpaper::delete_local_wallpapers_with(&paths, |p| fs::remove_file(p))
}

/// 分页列出某图源的搜索历史（每页默认 8 条，page 从 1 起）。
#[tauri::command]
pub async fn list_wallpaper_history(
    source: String,
    page: i64,
    page_size: i64,
    state: State<'_, DbState>,
) -> Result<WallpaperHistoryPage, String> {
    state
        .with_conn(move |conn| wallpaper::list_wallpaper_history_at(conn, &source, page, page_size))
        .await
}

/// 记录一次搜索历史：trim 后为空静默忽略，已存在则置顶。
#[tauri::command]
pub async fn add_wallpaper_history(
    source: String,
    keyword: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    state
        .with_conn(move |conn| wallpaper::add_wallpaper_history_at(conn, &source, &keyword))
        .await
}

/// 删除单条搜索历史（不存在静默成功）。
#[tauri::command]
pub async fn delete_wallpaper_history(
    source: String,
    keyword: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    state
        .with_conn(move |conn| wallpaper::delete_wallpaper_history_at(conn, &source, &keyword))
        .await
}

/// 清空某图源的全部搜索历史（不影响其他图源）。
#[tauri::command]
pub async fn clear_wallpaper_history(
    source: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    state
        .with_conn(move |conn| wallpaper::clear_wallpaper_history_at(conn, &source))
        .await
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

#[tauri::command]
pub fn current_log_file(app: AppHandle) -> Result<String, String> {
    crate::logging::current_log_file_with(log_dir_path(&app)).map(|p| p.display().to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let _ = init_logging(app);
            app.listen("frontend-log", move |event| {
                crate::logging::log_frontend_event(event.payload());
            });
            let cache_root = app
                .path()
                .app_cache_dir()
                .map_err(|e| format!("cannot resolve app cache dir: {e}"))?
                .join("wallpapers");
            let cache_dir = cache_root.join("thumbs");
            fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("cannot create thumb cache dir: {e}"))?;
            fs::create_dir_all(cache_root.join("full"))
                .map_err(|e| format!("cannot create full cache dir: {e}"))?;
            app.manage(ThumbState::new(cache_dir));
            // 打开失败不阻塞启动：state 存 None，命令返回错误而非崩溃。
            let db = match crate::db::db_path().and_then(|path| crate::db::open_db(&path)) {
                Ok(conn) => DbState(Arc::new(Mutex::new(Some(conn)))),
                Err(e) => {
                    log::error!("wallpaper history database unavailable: {e}");
                    DbState(Arc::new(Mutex::new(None)))
                }
            };
            app.manage(db);
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
            // 缓存未命中：若该 hash 已登记且没有在途下载，则立即发起一次真实网络拉取。
            // 成功后 emit thumb-ready 驱动前端重挂载；失败则交给前端下一轮重试再次触发，
            // 从而保证「点击/自动重试」等价于重新走网络而非仅重查缓存。
            if state.resolve(&hash).is_some() && !state.in_flight(&hash) {
                let handle = app.clone();
                let hash = hash.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<ThumbState>();
                    let settings = wallpaper_settings_from_config();
                    match state.get_or_fetch(&hash, &settings).await {
                        Ok(_) => {
                            let _ = handle.emit("thumb-ready", ());
                        }
                        Err(e) if e.contains("already in progress") => {
                            // 并发下他人已接管下载，其完成时会 emit，无需在此重复处理。
                        }
                        Err(e) => log::error!("thumb fetch-on-miss failed (hash={hash}): {e}"),
                    }
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
            relaunch_app,
            read_cmux_config,
            read_ghosty_config,
            write_cmux_config,
            write_ghosty_config,
            reload_cmux_config,
            read_cmux_setting,
            write_cmux_setting,
            detect_cmux,
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
            has_wallpaper_full_cache,
            get_wallpaper_cache_stats,
            clear_wallpaper_cache,
            get_cache_settings,
            save_cache_settings,
            get_app_cache_stats,
            clear_app_cache,
            list_local_wallpapers,
            wallpaper_thumb,
            read_local_wallpaper_file,
            delete_local_wallpapers,
            list_wallpaper_history,
            add_wallpaper_history,
            delete_wallpaper_history,
            clear_wallpaper_history,
            open_log_dir,
            current_log_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
