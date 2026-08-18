use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{StreamExt, TryStreamExt};
use image::GenericImageView;
use reqwest::Client;
use serde::{Deserialize, Deserializer, Serialize};

const USER_AGENT: &str = "workstation-wallpaper/0.1";
const DEFAULT_MIN_WIDTH: u32 = 1920;
const CACHE_META_FILE: &str = "cache_meta.json";
/// 缓存池子目录：缩略图缓存目录（ThumbState.dir 的管理根）。
pub const THUMBS_SUBDIR: &str = "thumbs";
/// 缓存池子目录：原图缓存目录。
pub const FULL_SUBDIR: &str = "full";

fn de_u32_string<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(serde_json::Value::Number(n)) => n
            .as_u64()
            .map(|v| Some(v as u32))
            .ok_or_else(|| serde::de::Error::custom("expected u32 number")),
        Some(serde_json::Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(serde_json::Value::String(s)) => s
            .trim()
            .parse::<u32>()
            .map(Some)
            .map_err(|_| serde::de::Error::custom(format!("invalid u32 string: {s}"))),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected number or numeric string, got {other}"
        ))),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WallpaperItem {
    pub id: String,
    pub source: String,
    pub thumb_url: String,
    pub thumb_hash: String,
    pub full_url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct SearchQuery {
    pub source: String,
    #[serde(default)]
    pub keywords: String,
    #[serde(default)]
    pub random: bool,
    #[serde(default)]
    pub page: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SourceSettings {
    pub api_key: Option<String>,
    pub login: Option<String>,
    pub categories: Option<String>,
    pub purity: Option<String>,
    #[serde(deserialize_with = "de_u32_string")]
    pub min_width: Option<u32>,
    #[serde(deserialize_with = "de_u32_string")]
    pub min_height: Option<u32>,
    pub rating: Option<String>,
    pub seed: Option<String>,
    pub ratios: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WallpaperSettings {
    pub proxy: Option<String>,
    pub download_dir: Option<String>,
    pub sources: HashMap<String, SourceSettings>,
    /// 缓存容量上限（字节）；空时使用默认 50GB。
    pub cache_limit_bytes: Option<u64>,
    /// 缓存池根目录（运行时由命令注入，不持久化）。
    #[serde(skip)]
    pub cache_root: Option<String>,
    #[serde(skip)]
    pub base_urls: HashMap<String, String>,
}

impl WallpaperSettings {
    pub fn source(&self, id: &str) -> SourceSettings {
        self.sources.get(id).cloned().unwrap_or_default()
    }

    /// 用全局代理配置覆盖 settings 内嵌 proxy：全局非空时覆盖（含覆盖 None），为空时置 None 直连。
    pub fn apply_global_proxy(&mut self, global: Option<String>) {
        self.proxy = match global {
            Some(p) if !p.trim().is_empty() => Some(p.trim().to_string()),
            _ => None,
        };
    }

    /// 有效缓存上限（字节）：配置值超范围时收敛到 [1GB, 200GB]，未配置用默认 50GB。
    pub fn cache_limit(&self) -> u64 {
        crate::app_cache::CacheSettings {
            cache_limit_bytes: self.cache_limit_bytes,
        }
        .cache_limit()
    }
}

fn build_client(proxy: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder().user_agent(USER_AGENT);
    if let Some(p) = proxy.filter(|p| !p.trim().is_empty()) {
        log::info!("using proxy: {p}");
        builder =
            builder.proxy(reqwest::Proxy::all(p).map_err(|e| format!("invalid proxy url: {e}"))?);
    } else {
        log::warn!("no proxy configured, connecting directly");
    }
    builder
        .build()
        .map_err(|e| format!("failed to build http client: {e}"))
}

fn http_error(status: reqwest::StatusCode, source: &str) -> String {
    format!("{source} request failed with HTTP {}", status.as_u16())
}

pub async fn search_wallpapers(
    query: SearchQuery,
    settings: WallpaperSettings,
) -> Result<Vec<WallpaperItem>, String> {
    log::info!(
        "search_wallpapers source={} keywords={:?} random={} page={} proxy={:?}",
        query.source,
        query.keywords,
        query.random,
        query.page,
        settings.proxy
    );
    let client = build_client(settings.proxy.as_deref())?;
    let src = settings.source(&query.source);
    let base = settings
        .base_urls
        .get(&query.source)
        .map(String::as_str)
        .unwrap_or(match query.source.as_str() {
            "wallhaven" => "https://wallhaven.cc",
            "danbooru" => "https://danbooru.donmai.us",
            _ => "https://safebooru.org",
        });
    match query.source.as_str() {
        "wallhaven" => search_wallhaven(&client, &query, &src, base).await,
        "danbooru" => search_danbooru(&client, &query, &src, base).await,
        "safebooru" => search_safebooru(&client, &query, &src, base).await,
        other => Err(format!("unknown wallpaper source: {other}")),
    }
}

#[derive(Deserialize)]
struct WallhavenResponse {
    data: Vec<WallhavenItem>,
}

#[derive(Deserialize)]
struct WallhavenItem {
    id: String,
    path: String,
    thumbs: WallhavenThumbs,
    dimension_x: u32,
    dimension_y: u32,
}

#[derive(Deserialize)]
struct WallhavenThumbs {
    small: String,
}

async fn search_wallhaven(
    client: &Client,
    query: &SearchQuery,
    src: &SourceSettings,
    base_url: &str,
) -> Result<Vec<WallpaperItem>, String> {
    let mut url =
        reqwest::Url::parse(&format!("{base_url}/api/v1/search")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("categories", src.categories.as_deref().unwrap_or("010"));
        pairs.append_pair("purity", src.purity.as_deref().unwrap_or("100"));
        if query.page > 1 {
            pairs.append_pair("page", &query.page.to_string());
        }
        if let Some(key) = src.api_key.as_deref().filter(|k| !k.is_empty()) {
            pairs.append_pair("apikey", key);
        }
        if query.random {
            pairs.append_pair("sorting", "random");
            pairs.append_pair("order", "desc");
            if let Some(seed) = src.seed.as_deref().filter(|s| !s.trim().is_empty()) {
                pairs.append_pair("seed", seed.trim());
            }
        }
        let joined = src
            .ratios
            .as_deref()
            .into_iter()
            .flat_map(|s| s.split(','))
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .collect::<Vec<_>>()
            .join(",");
        if !joined.is_empty() {
            pairs.append_pair("ratios", &joined);
        }
        let kw = query.keywords.trim();
        if !kw.is_empty() {
            pairs.append_pair("q", kw);
        }
    }
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("wallhaven request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(http_error(resp.status(), "wallhaven"));
    }
    let body: WallhavenResponse = resp
        .json()
        .await
        .map_err(|e| format!("wallhaven response parse failed: {e}"))?;
    Ok(body
        .data
        .into_iter()
        .map(|it| {
            let thumb_url = it.thumbs.small;
            let thumb_hash = thumb_hash(&thumb_url);
            WallpaperItem {
                id: format!("wallhaven-{}", it.id),
                source: "wallhaven".to_string(),
                thumb_url,
                thumb_hash,
                full_url: it.path,
                width: it.dimension_x,
                height: it.dimension_y,
            }
        })
        .collect())
}

#[derive(Deserialize)]
struct DanbooruItem {
    id: u64,
    file_url: Option<String>,
    preview_file_url: Option<String>,
    image_width: u32,
    image_height: u32,
}

async fn search_danbooru(
    client: &Client,
    query: &SearchQuery,
    src: &SourceSettings,
    base_url: &str,
) -> Result<Vec<WallpaperItem>, String> {
    let min_width = src.min_width.unwrap_or(DEFAULT_MIN_WIDTH);
    let rating = src.rating.as_deref().unwrap_or("safe");
    let mut tags = vec![
        format!("rating:{rating}"),
        "is_uploader_only:false".to_string(),
    ];
    let kw = query.keywords.trim();
    if !kw.is_empty() {
        tags.extend(kw.split_whitespace().map(|t| t.to_string()));
    }
    let mut url =
        reqwest::Url::parse(&format!("{base_url}/posts.json")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("tags", &tags.join(" "));
        pairs.append_pair("limit", "24");
        if query.page > 1 {
            pairs.append_pair("page", &query.page.to_string());
        }
        if query.random {
            pairs.append_pair("random", "true");
        }
    }
    let mut req = client.get(url);
    if let (Some(login), Some(key)) = (
        src.login.as_deref().filter(|l| !l.is_empty()),
        src.api_key.as_deref().filter(|k| !k.is_empty()),
    ) {
        req = req.basic_auth(login, Some(key));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("danbooru request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(http_error(resp.status(), "danbooru"));
    }
    let body: Vec<DanbooruItem> = resp
        .json()
        .await
        .map_err(|e| format!("danbooru response parse failed: {e}"))?;
    let mut out = Vec::new();
    for it in body {
        let Some(full) = it.file_url else { continue };
        if full.contains("lorem") {
            continue;
        }
        let Some(thumb) = it.preview_file_url else {
            continue;
        };
        if it.image_width < min_width {
            continue;
        }
        out.push(WallpaperItem {
            id: format!("danbooru-{}", it.id),
            source: "danbooru".to_string(),
            thumb_hash: thumb_hash(&thumb),
            thumb_url: thumb,
            full_url: full,
            width: it.image_width,
            height: it.image_height,
        });
    }
    Ok(out)
}

#[derive(Deserialize)]
struct SafebooruItem {
    id: u64,
    file_url: Option<String>,
    sample_url: Option<String>,
    width: u32,
    height: u32,
}

async fn search_safebooru(
    client: &Client,
    query: &SearchQuery,
    src: &SourceSettings,
    base_url: &str,
) -> Result<Vec<WallpaperItem>, String> {
    let min_width = src.min_width.unwrap_or(DEFAULT_MIN_WIDTH);
    let mut url =
        reqwest::Url::parse(&format!("{base_url}/index.php")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("page", "dapi");
        pairs.append_pair("s", "post");
        pairs.append_pair("q", "index");
        pairs.append_pair("json", "1");
        pairs.append_pair("limit", "24");
        if query.page > 1 {
            pairs.append_pair("pid", &((query.page - 1) * 24).to_string());
        }
        let kw = query.keywords.trim();
        if !kw.is_empty() {
            pairs.append_pair("tags", kw);
        }
    }
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("safebooru request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(http_error(resp.status(), "safebooru"));
    }
    let body: Vec<SafebooruItem> = resp
        .json()
        .await
        .map_err(|e| format!("safebooru response parse failed: {e}"))?;
    let mut out = Vec::new();
    for it in body {
        let thumb = it.sample_url.clone();
        let full = it.file_url.or(thumb.clone());
        let Some(full) = full else { continue };
        let thumb = thumb.unwrap_or_else(|| full.clone());
        if it.width < min_width {
            continue;
        }
        out.push(WallpaperItem {
            id: format!("safebooru-{}", it.id),
            source: "safebooru".to_string(),
            thumb_hash: thumb_hash(&thumb),
            thumb_url: thumb,
            full_url: full,
            width: it.width,
            height: it.height,
        });
    }
    Ok(out)
}

fn mime_from_content_type(content_type: &str) -> &'static str {
    mime_for_ext(extension_from_content_type(content_type))
}

fn extension_from_content_type(content_type: &str) -> &str {
    let lower = content_type.to_ascii_lowercase();
    if lower.contains("png") {
        "png"
    } else if lower.contains("webp") {
        "webp"
    } else if lower.contains("gif") {
        "gif"
    } else {
        "jpg"
    }
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.chars().all(|c| c == '-' || c == '_' || c == '.') {
        "wallpaper".to_string()
    } else {
        cleaned
    }
}

async fn write_download_stream(
    path: &Path,
    mut stream: impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Unpin,
) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|e| format!("cannot create file: {e}"))?;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("cannot write file: {e}"))?;
    }
    file.flush()
        .map_err(|e| format!("cannot flush file: {e}"))?;
    Ok(())
}

pub async fn download_wallpaper(
    item: WallpaperItem,
    settings: WallpaperSettings,
) -> Result<String, String> {
    let dir = settings
        .download_dir
        .as_deref()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create download dir: {e}"))?;

    // 经 fetch_full_image 取字节：命中原图缓存时零网络请求，未命中经代理下载
    let (bytes, mime) = fetch_full_image(item.clone(), settings).await?;
    let ext = extension_from_content_type(&mime);
    let file_name = sanitize_file_name(&item.id);
    let path = dir.join(format!("{file_name}.{ext}"));
    fs::write(&path, &bytes).map_err(|e| format!("cannot write wallpaper file: {e}"))?;
    Ok(path.display().to_string())
}

/// 经缓存/代理下载原图，返回原始字节与推断的 mime（content-type 缺失时回退 image/jpeg）。
/// 命中原图缓存时直接返回缓存字节且不发起网络请求；未命中时经代理下载并将结果写入缓存。
pub async fn fetch_full_image(
    item: WallpaperItem,
    settings: WallpaperSettings,
) -> Result<(Vec<u8>, String), String> {
    let key = thumb_hash(&item.full_url);
    if let Some(pool) = settings.cache_root.as_deref().map(PathBuf::from) {
        if let Some((bytes, mime)) = full_image_cache_get(&pool, &key) {
            return Ok((bytes, mime));
        }
    }
    let client = build_client(settings.proxy.as_deref())?;
    let resp = client
        .get(&item.full_url)
        .send()
        .await
        .map_err(|e| format!("full image request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(http_error(resp.status(), "full image"));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(mime_from_content_type)
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("full image body read failed: {e}"))?;
    let bytes = bytes.to_vec();
    if let Some(pool) = settings.cache_root.as_deref().map(PathBuf::from) {
        let _ = full_image_cache_put(&pool, &key, &bytes, &mime);
        let _ = enforce_cache_limit(&pool, settings.cache_limit());
    }
    Ok((bytes, mime))
}

/// 将图片字节拼装为 `data:<mime>;base64,...` 形式的 data URL。
pub fn full_image_data_url(bytes: &[u8], mime: &str) -> String {
    use base64::Engine as _;
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// 本地壁纸目录中的一张壁纸文件信息。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWallpaperInfo {
    pub file_name: String,
    pub absolute_path: String,
    pub size_bytes: u64,
    pub modified_at_ms: u64,
    pub thumb_data_url: String,
}

/// 解析壁纸下载目录：优先用 settings.download_dir，否则默认 `~/.config/cmux/wallpapers/`。
pub fn wallpapers_dir(settings: &WallpaperSettings) -> PathBuf {
    settings
        .download_dir
        .as_ref()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dir)
}

pub const IMAGE_EXTS: [&str; 6] = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

pub fn is_image_file_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    IMAGE_EXTS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

pub fn local_wallpaper_entries(dir: &Path) -> Vec<LocalWallpaperEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            if !meta.is_file() || !is_image_file_name(&entry.file_name().to_string_lossy()) {
                return None;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(LocalWallpaperEntry {
                path: entry.path(),
                size_bytes: meta.len(),
                modified_ms,
            })
        })
        .collect()
}

pub struct LocalWallpaperEntry {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

/// 缩略图内存缓存：`(路径, 修改时间, 文件大小) -> data URL`，文件未变化时复用，
/// 避免每次进入本地壁纸库都重新解码大图。存储由通用 app 缓存提供。
fn thumb_cache_key(path: &Path, size_bytes: u64, modified_ms: u64) -> String {
    format!("{}:{}:{}", path.display(), size_bytes, modified_ms)
}

/// 生成缩略图 data URL：解码图片并缩放到最大边不超过 `max_edge` 像素，
/// 编码为 JPEG data URL；解码/编码失败或文件缺失返回 None（占位缩略图）。
pub fn thumbnail_data_url(path: &Path, max_edge: u32) -> Option<String> {
    let reader = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?;
    let img = reader.decode().ok()?;
    let (width, height) = img.dimensions();
    let longest = width.max(height);
    let thumb = if longest <= max_edge {
        img
    } else {
        let scale = max_edge as f64 / longest as f64;
        let new_width = ((width as f64 * scale).round() as u32).max(1);
        let new_height = ((height as f64 * scale).round() as u32).max(1);
        img.resize(new_width, new_height, image::imageops::FilterType::Triangle)
    };
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    thumb.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
    Some(full_image_data_url(&buf, "image/jpeg"))
}

/// 带内存缓存的缩略图生成：命中缓存（路径+修改时间+大小未变）直接返回，
/// 未命中则生成并写入缓存。生成失败不缓存。
pub fn cached_thumbnail_data_url(
    path: &Path,
    size_bytes: u64,
    modified_ms: u64,
    max_edge: u32,
) -> Option<String> {
    let key = thumb_cache_key(path, size_bytes, modified_ms);
    if let Some(url) = crate::app_cache::get::<String>(crate::app_cache::NS_THUMBS, &key) {
        return Some(url);
    }
    let url = thumbnail_data_url(path, max_edge)?;
    crate::app_cache::insert(crate::app_cache::NS_THUMBS, &key, url.clone());
    Some(url)
}

/// 清理缩略图内存缓存（测试与目录变更时使用）。
pub fn clear_thumb_cache() {
    crate::app_cache::clear_namespace(crate::app_cache::NS_THUMBS);
}

/// 列出本地壁纸目录中的壁纸文件（按修改时间倒序），供 tauri 命令注入实现。
/// `read_entries` 读取目录条目，`thumb_fn` 为每个文件生成缩略图 data URL（失败返回 None 以占位）。
pub fn list_local_wallpapers_with(
    dir: &Path,
    read_entries: impl Fn(&Path) -> Vec<LocalWallpaperEntry>,
    thumb_fn: impl Fn(&Path) -> Option<String>,
) -> Vec<LocalWallpaperInfo> {
    let mut entries = read_entries(dir);
    entries.sort_by_key(|e| std::cmp::Reverse(e.modified_ms));
    entries
        .into_iter()
        .map(|e| LocalWallpaperInfo {
            file_name: e
                .path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            absolute_path: e.path.display().to_string(),
            size_bytes: e.size_bytes,
            modified_at_ms: e.modified_ms,
            thumb_data_url: thumb_fn(&e.path).unwrap_or_default(),
        })
        .collect()
}

/// 读取本地图片文件字节并生成 data URL（大图预览用）。
pub fn read_local_wallpaper_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read wallpaper file: {e}"))?;
    let mime = match image::guess_format(&bytes) {
        Ok(image::ImageFormat::Png) => "image/png",
        Ok(image::ImageFormat::WebP) => "image/webp",
        Ok(image::ImageFormat::Gif) => "image/gif",
        Ok(_) => "image/jpeg",
        Err(_) => "image/jpeg",
    };
    Ok(full_image_data_url(&bytes, mime))
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWallpapersResult {
    pub deleted: Vec<String>,
    pub errors: Vec<String>,
}

/// 逐个删除本地壁纸文件并汇总结果：单个失败不影响其余文件。
pub fn delete_local_wallpapers_with(
    paths: &[String],
    remove_file: impl Fn(&Path) -> std::io::Result<()>,
) -> DeleteWallpapersResult {
    let mut result = DeleteWallpapersResult::default();
    for p in paths {
        let path = PathBuf::from(p);
        match remove_file(&path) {
            Ok(()) => result.deleted.push(p.clone()),
            Err(e) => result.errors.push(format!("{p}: {e}")),
        }
    }
    result
}

fn default_download_dir_from(home: Option<PathBuf>) -> PathBuf {
    home.map(|d| d.join(".config").join("cmux").join("wallpapers"))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn default_download_dir() -> PathBuf {
    default_download_dir_from(dirs::home_dir())
}

pub fn thumb_hash(url: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThumbMetaEntry {
    pub url: String,
    pub size: u64,
    pub ext: String,
    pub last_access_ms: u64,
}

pub type ThumbIndex = HashMap<String, ThumbMetaEntry>;

fn cache_file_path(dir: &Path, hash: &str, ext: &str) -> PathBuf {
    dir.join(format!("{hash}.{ext}"))
}

/// 缓存池根目录由缩略图缓存目录推导：池根 = thumb 目录的父目录（`.../wallpapers`）。
pub fn cache_pool_root(thumbs_dir: &Path) -> PathBuf {
    thumbs_dir
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| thumbs_dir.to_path_buf())
}

/// 缩略图缓存子目录。
pub fn thumbs_cache_dir(pool: &Path) -> PathBuf {
    pool.join(THUMBS_SUBDIR)
}

/// 原图缓存子目录。
pub fn full_cache_dir(pool: &Path) -> PathBuf {
    pool.join(FULL_SUBDIR)
}

/// 原图缓存文件路径：`pool/full/{key}.{ext}`。
pub fn full_image_cache_path(pool: &Path, key: &str, ext: &str) -> PathBuf {
    full_cache_dir(pool).join(format!("{key}.{ext}"))
}

/// 读取原图缓存：返回字节与 mime（按扩展名推断）；命中时刷新文件最后访问时间。
/// 未命中返回 None。目录不可读按未命中处理，不报错。
pub fn full_image_cache_get(pool: &Path, key: &str) -> Option<(Vec<u8>, String)> {
    let dir = full_cache_dir(pool);
    let prefix = format!("{key}.");
    let file = fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with(&prefix)
        })?;
    let ext = file.extension()?.to_string_lossy().to_string();
    let bytes = fs::read(&file).ok()?;
    let _ = touch_file_mtime(&file);
    Some((bytes, mime_for_ext(&ext).to_string()))
}

/// 写原图缓存：以 `<key>.<mime-ext>` 写入临时文件后原子改名，并刷新访问时间。
pub fn full_image_cache_put(
    pool: &Path,
    key: &str,
    bytes: &[u8],
    mime: &str,
) -> Result<(), String> {
    let dir = full_cache_dir(pool);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create full cache dir: {e}"))?;
    let ext = extension_from_content_type(mime);
    let target = full_image_cache_path(pool, key, ext);
    let tmp = dir.join(format!(".{key}.{}.tmp", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("cannot write full cache tmp: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot rename full cache tmp: {e}")
    })?;
    let _ = touch_file_mtime(&target);
    // 同 key 其他扩展名的旧条目随 mime 变更移除，避免残留
    let prefix = format!("{key}.");
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == target {
            continue;
        }
        if path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .starts_with(&prefix)
        {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

/// 更新文件最后访问时间（用于文件级别 LRU 的热度刷新）；失败静默。
fn touch_file_mtime(path: &Path) -> std::io::Result<()> {
    let t = filetime::FileTime::now();
    filetime::set_file_mtime(path, t)
}

/// 惰性 LRU 淘汰：扫描缓存池内 `thumbs/` 与 `full/` 全部文件，
/// 总字节数超过 `cap_bytes` 时按最后访问时间（mtime）从旧到新删除直至达标。
/// 返回被删除的文件路径（供调用方同步自己的索引/缓存状态）。
pub fn enforce_cache_limit(pool: &Path, cap_bytes: u64) -> Vec<PathBuf> {
    let mut files: Vec<(PathBuf, u64, u64)> = Vec::new();
    let mut total: u64 = 0;
    for sub in [THUMBS_SUBDIR, FULL_SUBDIR] {
        let dir = pool.join(sub);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name == CACHE_META_FILE {
                continue;
            }
            let Ok(meta) = fs::metadata(&path) else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let size = meta.len();
            let last_access_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            total += size;
            files.push((path, size, last_access_ms));
        }
    }
    if total <= cap_bytes {
        return Vec::new();
    }
    files.sort_by_key(|(_, size, ts)| {
        let _ = size;
        *ts
    });
    let mut removed = Vec::new();
    let mut now_total = total;
    for (path, size, _) in files {
        if now_total <= cap_bytes {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            now_total -= size;
            removed.push(path);
        }
    }
    removed
}

/// 缓存池占用统计：`(total, thumb_bytes, full_bytes)`。
pub fn full_image_cache_size(pool: &Path) -> (u64, u64, u64) {
    let mut thumb = 0u64;
    let mut full = 0u64;
    for (sub, slot) in [(THUMBS_SUBDIR, &mut thumb), (FULL_SUBDIR, &mut full)] {
        let dir = pool.join(sub);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_name().unwrap_or_default() == CACHE_META_FILE {
                continue;
            }
            if let Ok(meta) = fs::metadata(&path) {
                if meta.is_file() {
                    *slot += meta.len();
                }
            }
        }
    }
    (thumb + full, thumb, full)
}

/// 清空缓存池：删除 `thumbs/` 与 `full/` 下全部缓存文件（保留 cache_meta.json），
/// 不影响本地壁纸库（下载目录）。目录不存在视为空，不报错。
pub fn clear_wallpaper_cache(pool: &Path) -> Result<(), String> {
    for sub in [THUMBS_SUBDIR, FULL_SUBDIR] {
        let dir = pool.join(sub);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_name().unwrap_or_default() == CACHE_META_FILE {
                continue;
            }
            if path.is_file() {
                fs::remove_file(&path).map_err(|e| format!("cannot clear cache file: {e}"))?;
            }
        }
    }
    Ok(())
}

fn load_thumb_index(dir: &Path) -> ThumbIndex {
    let path = dir.join(CACHE_META_FILE);
    match fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(index) => index,
        None => rebuild_thumb_index(dir),
    }
}

fn rebuild_thumb_index(dir: &Path) -> ThumbIndex {
    let mut index = ThumbIndex::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return index;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name == CACHE_META_FILE {
            continue;
        }
        let Some((hash, ext)) = name.rsplit_once('.') else {
            continue;
        };
        if hash.is_empty() || ext.len() > 5 {
            continue;
        }
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let last_access_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        index.insert(
            hash.to_string(),
            ThumbMetaEntry {
                url: String::new(),
                size: meta.len(),
                ext: ext.to_string(),
                last_access_ms,
            },
        );
    }
    index
}

fn save_thumb_index(dir: &Path, index: &ThumbIndex) {
    if let Ok(json) = serde_json::to_string(index) {
        let _ = fs::write(dir.join(CACHE_META_FILE), json);
    }
}

fn lazy_prune_locked(dir: &Path, index: &mut ThumbIndex, active: &HashMap<String, String>) {
    let stale: Vec<String> = index
        .keys()
        .filter(|hash| !active.contains_key(*hash))
        .cloned()
        .collect();
    for hash in stale {
        if let Some(entry) = index.remove(&hash) {
            let _ = fs::remove_file(cache_file_path(dir, &hash, &entry.ext));
        }
    }
    let _ = fs::write(
        dir.join(CACHE_META_FILE),
        serde_json::to_string(index).unwrap_or_default(),
    );
}

/// 从缩略图缓存文件路径解析缓存 hash（`<hash>.<ext>`）；无法解析返回 None。
fn hash_from_cache_path(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy();
    let (hash, _ext) = name.rsplit_once('.')?;
    Some(hash.to_string())
}

pub struct ThumbState {
    dir: PathBuf,
    registry: RwLock<HashMap<String, String>>,
    index: RwLock<ThumbIndex>,
}

impl ThumbState {
    pub fn new(dir: PathBuf) -> Self {
        let index = load_thumb_index(&dir);
        Self {
            dir,
            registry: RwLock::new(HashMap::new()),
            index: RwLock::new(index),
        }
    }

    pub fn register(&self, items: &[WallpaperItem]) {
        let mut registry = self.registry.write().unwrap();
        for item in items {
            registry.insert(item.thumb_hash.clone(), item.thumb_url.clone());
        }
        let mut index = self.index.write().unwrap();
        lazy_prune_locked(&self.dir, &mut index, &registry);
    }

    pub fn resolve(&self, hash: &str) -> Option<String> {
        self.registry.read().unwrap().get(hash).cloned()
    }

    /// 供协议读取：命中缓存时刷新文件 mtime（保持 LRU 热度）以配合文件级统一LRU。
    pub fn cached(&self, hash: &str) -> Option<(Vec<u8>, &'static str)> {
        let entry = self.index.read().unwrap().get(hash).cloned()?;
        let path = cache_file_path(&self.dir, hash, &entry.ext);
        if !path.is_file() {
            return None;
        }
        let bytes = fs::read(&path).ok()?;
        {
            let mut index = self.index.write().unwrap();
            if let Some(e) = index.get_mut(hash) {
                e.last_access_ms = now_ms();
            }
        }
        let _ = touch_file_mtime(&path);
        Some((bytes, mime_for_ext(&entry.ext)))
    }

    pub async fn get_or_fetch(
        &self,
        hash: &str,
        settings: &WallpaperSettings,
    ) -> Result<(Vec<u8>, &'static str), String> {
        if let Some(hit) = self.cached(hash) {
            return Ok(hit);
        }
        let url = self
            .resolve(hash)
            .ok_or_else(|| "unknown thumb hash".to_string())?;
        let client = build_client(settings.proxy.as_deref())?;
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("thumb request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(http_error(resp.status(), "thumb"));
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/jpeg")
            .to_string();
        let ext = extension_from_content_type(&content_type);
        let path = cache_file_path(&self.dir, hash, ext);
        let stream = resp.bytes_stream().map_err(std::io::Error::other);
        write_download_stream(&path, stream).await?;
        let size = fs::metadata(&path)
            .map_err(|e| format!("cache stat failed: {e}"))?
            .len();
        {
            let mut index = self.index.write().unwrap();
            index.insert(
                hash.to_string(),
                ThumbMetaEntry {
                    url,
                    size,
                    ext: ext.to_string(),
                    last_access_ms: now_ms(),
                },
            );
            // 统一池级 LRU：缩略图/原图同享缓存上限，超限按文件 mtime 淘汰最旧。
            // 删除的缩略图文件需同步清理 index，避免索引残留。
            let removed = enforce_cache_limit(&cache_pool_root(&self.dir), settings.cache_limit());
            for p in &removed {
                if let Some(removed_hash) = hash_from_cache_path(p) {
                    index.remove(&removed_hash);
                }
            }
        }
        save_thumb_index(&self.dir, &self.index.read().unwrap());
        let bytes = fs::read(&path).map_err(|e| format!("cache read failed: {e}"))?;
        Ok((bytes, mime_for_ext(ext)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// 串行化共享全局缩略图缓存（app_cache）的测试，避免并发清空导致淘汰路径竞态。
    use crate::app_cache::APP_CACHE_TEST_LOCK as THUMB_CACHE_TEST_LOCK;

    struct MockServer {
        addr: String,
        counter: Arc<AtomicUsize>,
        requests: Arc<Mutex<Vec<String>>>,
    }

    impl MockServer {
        fn new(responses: Vec<(u16, &'static str, &'static str)>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap().to_string();
            let responses = Arc::new(responses);
            let counter = Arc::new(AtomicUsize::new(0));
            let requests: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
            let (r2, c2, reqs) = (responses.clone(), counter.clone(), requests.clone());
            thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { break };
                    let idx = c2.fetch_add(1, Ordering::SeqCst);
                    let (status, body, content_type) =
                        r2.get(idx)
                            .copied()
                            .unwrap_or((200, "[]", "application/json"));
                    if let Ok(first_line) = serve(&mut stream, status, body, content_type) {
                        reqs.lock().unwrap().push(first_line);
                    }
                }
            });
            Self {
                addr,
                counter,
                requests,
            }
        }

        fn ok(body: &'static str) -> Self {
            Self::new(vec![(200, body, "application/json")])
        }

        fn base_url(&self) -> String {
            format!("http://{}", self.addr)
        }

        fn hit_count(&self) -> usize {
            self.counter.load(Ordering::SeqCst)
        }

        fn request_lines(&self) -> Vec<String> {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            loop {
                let lines = self.requests.lock().unwrap().clone();
                if lines.len() >= self.hit_count() || std::time::Instant::now() > deadline {
                    return lines;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }

    fn serve(
        stream: &mut TcpStream,
        status: u16,
        body: &str,
        content_type: &str,
    ) -> std::io::Result<String> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut request_line = String::new();
        reader.read_line(&mut request_line)?;
        for line in reader.by_ref().lines() {
            let line = line?;
            if line.is_empty() {
                break;
            }
        }
        let reason = if status == 200 { "OK" } else { "ERROR" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes())?;
        stream.flush()?;
        Ok(request_line.trim().to_string())
    }

    fn read_body(path: &Path) -> String {
        let mut f = std::fs::File::open(path).unwrap();
        let mut s = String::new();
        f.read_to_string(&mut s).unwrap();
        s
    }

    fn settings_with_sources(proxy: Option<&str>, sources: &[(&str, &str)]) -> WallpaperSettings {
        let map: HashMap<String, SourceSettings> = sources
            .iter()
            .map(|(id, json)| ((*id).to_string(), serde_json::from_str(json).unwrap()))
            .collect();
        WallpaperSettings {
            proxy: proxy.map(|p| p.to_string()),
            download_dir: None,
            sources: map,
            cache_limit_bytes: None,
            cache_root: None,
            base_urls: HashMap::new(),
        }
    }

    #[test]
    fn extension_from_content_type_maps_common_types() {
        assert_eq!(extension_from_content_type("image/jpeg"), "jpg");
        assert_eq!(extension_from_content_type("image/png"), "png");
        assert_eq!(extension_from_content_type("image/webp"), "webp");
        assert_eq!(extension_from_content_type("image/gif"), "gif");
        assert_eq!(extension_from_content_type("IMAGE/PNG"), "png");
        assert_eq!(
            extension_from_content_type("application/octet-stream"),
            "jpg"
        );
    }

    #[test]
    fn sanitize_file_name_replaces_invalid_chars() {
        assert_eq!(sanitize_file_name("wallhaven-zmzy9w"), "wallhaven-zmzy9w");
        assert_eq!(sanitize_file_name("danbooru-12345"), "danbooru-12345");
        assert_eq!(sanitize_file_name("a/b c:d"), "a-b-c-d");
        assert_eq!(sanitize_file_name("///"), "wallpaper");
    }

    #[test]
    fn default_download_dir_points_under_cmux_config() {
        let dir = default_download_dir();
        assert!(dir.file_name().unwrap() == "wallpapers");
    }

    #[test]
    fn default_download_dir_from_none_home_falls_back_to_current_dir() {
        assert_eq!(default_download_dir_from(None), PathBuf::from("."));
    }

    #[test]
    fn write_download_stream_writes_chunks() {
        let dir =
            std::env::temp_dir().join(format!("workstation-wall-stream-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.jpg");
        let stream = futures_util::stream::iter(vec![
            Ok(bytes::Bytes::from_static(b"ab")),
            Ok(bytes::Bytes::from_static(b"cd")),
        ]);
        tauri::async_runtime::block_on(write_download_stream(&path, stream)).unwrap();
        assert_eq!(read_body(&path), "abcd");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_download_stream_propagates_stream_error() {
        let dir = std::env::temp_dir().join(format!(
            "workstation-wall-stream-err-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("out.jpg");
        let stream = futures_util::stream::iter(vec![Err(std::io::Error::other("boom"))]);
        let err = tauri::async_runtime::block_on(write_download_stream(&path, stream)).unwrap_err();
        assert!(err.contains("stream error"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_download_stream_propagates_create_error() {
        let blocker = std::env::temp_dir().join(format!(
            "workstation-wall-stream-blocker-{}",
            std::process::id()
        ));
        std::fs::write(&blocker, "i am a file").unwrap();
        let path = blocker.join("nested").join("out.jpg");
        let stream = futures_util::stream::iter(vec![Ok(bytes::Bytes::from_static(b"a"))]);
        let err = tauri::async_runtime::block_on(write_download_stream(&path, stream)).unwrap_err();
        assert!(err.contains("cannot create file"));
        let _ = std::fs::remove_file(&blocker);
    }

    #[test]
    fn build_client_accepts_proxy_and_none() {
        assert!(build_client(Some("http://127.0.0.1:7890")).is_ok());
        assert!(build_client(None).is_ok());
        assert!(build_client(Some("not a valid url")).is_err());
    }

    #[test]
    fn apply_global_proxy_overrides_embedded_proxy() {
        let mut settings = settings_with_sources(Some("http://embedded:8080"), &[]);
        settings.apply_global_proxy(Some("http://127.0.0.1:7890".to_string()));
        assert_eq!(settings.proxy.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn apply_global_proxy_fills_missing_proxy() {
        let mut settings = settings_with_sources(None, &[]);
        settings.apply_global_proxy(Some("http://127.0.0.1:7890".to_string()));
        assert_eq!(settings.proxy.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn apply_global_proxy_clears_proxy_on_empty_string() {
        let mut settings = settings_with_sources(Some("http://embedded:8080"), &[]);
        settings.apply_global_proxy(Some("   ".to_string()));
        assert_eq!(settings.proxy, None);
    }

    #[test]
    fn apply_global_proxy_clears_proxy_on_none() {
        let mut settings = settings_with_sources(Some("http://embedded:8080"), &[]);
        settings.apply_global_proxy(None);
        assert_eq!(settings.proxy, None);
    }

    #[test]
    fn apply_global_proxy_trims_whitespace() {
        let mut settings = settings_with_sources(None, &[]);
        settings.apply_global_proxy(Some("  http://127.0.0.1:7890  ".to_string()));
        assert_eq!(settings.proxy.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn search_unknown_source_returns_error() {
        let settings = WallpaperSettings::default();
        let result = search_wallpapers(
            SearchQuery {
                source: "nope".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        );
        let err = tauri::async_runtime::block_on(result).unwrap_err();
        assert!(err.contains("unknown wallpaper source"));
    }

    #[test]
    fn search_wallhaven_parses_all_items_without_resolution_filter() {
        let server = MockServer::new(vec![(
            200,
            r#"{"data":[{"id":"a1","path":"https://img/full1.jpg","thumbs":{"small":"https://t/1.jpg"},"dimension_x":2560,"dimension_y":1440},{"id":"a2","path":"https://img/full2.jpg","thumbs":{"small":"https://t/2.jpg"},"dimension_x":1280,"dimension_y":720}]}"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: "anime".to_string(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings {
            api_key: Some("k1".to_string()),
            purity: Some("110".to_string()),
            categories: Some("111".to_string()),
            min_width: Some(1920),
            min_height: Some(1080),
            rating: None,
            login: None,
            seed: None,
            ratios: None,
        };
        let items = tauri::async_runtime::block_on(search_wallhaven(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "wallhaven-a1");
        assert_eq!(items[0].source, "wallhaven");
        assert_eq!(items[0].thumb_url, "https://t/1.jpg");
        assert_eq!(items[0].width, 2560);
        assert_eq!(items[1].id, "wallhaven-a2");
        assert_eq!(items[1].width, 1280);
        assert_eq!(server.hit_count(), 1);
    }

    #[test]
    fn search_wallhaven_omits_atleast_param() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings {
            min_width: Some(1920),
            min_height: Some(1080),
            ..SourceSettings::default()
        };
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(!lines[0].contains("atleast="), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallhaven_random_adds_sorting() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: true,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let items = tauri::async_runtime::block_on(search_wallhaven(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert!(items.is_empty());
        assert_eq!(server.hit_count(), 1);
    }

    #[test]
    fn search_wallhaven_random_adds_seed_when_configured() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: true,
            ..Default::default()
        };
        let src = SourceSettings {
            seed: Some("abc123".to_string()),
            ..SourceSettings::default()
        };
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("seed=abc123"), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallhaven_random_omits_empty_seed() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: true,
            ..Default::default()
        };
        let src = SourceSettings {
            seed: Some("   ".to_string()),
            ..SourceSettings::default()
        };
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(!lines[0].contains("seed="), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallhaven_sends_ratios_multi_values() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings {
            ratios: Some("16x9, 21x9, 32x9".to_string()),
            ..SourceSettings::default()
        };
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].matches("ratios=").count(), 1, "got: {}", lines[0]);
        let request = &lines[0];
        assert!(request.contains("ratios=16x9%2C21x9%2C32x9"));
    }

    #[test]
    fn search_wallhaven_joins_ratios_ignoring_spaces_and_empty() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings {
            ratios: Some("16x9, , 16x10".to_string()),
            ..SourceSettings::default()
        };
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].matches("ratios=").count(), 1, "got: {}", lines[0]);
        let request = &lines[0];
        assert!(request.contains("ratios=16x9%2C16x10"));
    }

    #[test]
    fn search_wallhaven_omits_empty_ratios() {
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        for ratios in [None, Some(String::new()), Some(" , , ".to_string())] {
            let server = MockServer::ok(r#"{"data":[]}"#);
            let src = SourceSettings {
                ratios,
                ..SourceSettings::default()
            };
            tauri::async_runtime::block_on(search_wallhaven(
                &client,
                &query,
                &src,
                &server.base_url(),
            ))
            .unwrap();
            let lines = server.request_lines();
            assert_eq!(lines.len(), 1);
            assert!(!lines[0].contains("ratios="), "got: {}", lines[0]);
        }
    }

    #[test]
    fn search_wallhaven_random_keeps_ratios() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: true,
            ..Default::default()
        };
        let src = SourceSettings {
            ratios: Some("16x9".to_string()),
            ..SourceSettings::default()
        };
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("sorting=random"), "got: {}", lines[0]);
        assert!(lines[0].contains("ratios=16x9"), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallhaven_includes_page_param_when_gt_one() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            page: 2,
        };
        let src = SourceSettings::default();
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("page=2"), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallhaven_omits_page_param_on_first_page() {
        let server = MockServer::ok(r#"{"data":[]}"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        tauri::async_runtime::block_on(search_wallhaven(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(!lines[0].contains("page="), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallhaven_http_error_is_propagated() {
        let server = MockServer::new(vec![(403, r#"{"error":"denied"}"#, "text/plain")]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let err = tauri::async_runtime::block_on(search_wallhaven(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap_err();
        assert!(err.contains("wallhaven"));
    }

    #[test]
    fn search_wallhaven_invalid_json_is_error() {
        let server = MockServer::new(vec![(200, "not json", "application/json")]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "wallhaven".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let err = tauri::async_runtime::block_on(search_wallhaven(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap_err();
        assert!(err.contains("parse failed"));
    }

    #[test]
    fn search_danbooru_filters_placeholders_and_skips_narrow() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":1,"file_url":"https://cdn/db1.jpg","preview_file_url":"https://cdn/p1.jpg","image_width":2560,"image_height":1440},{"id":2,"file_url":"https://loremflickr.com/1.jpg","preview_file_url":"https://cdn/p2.jpg","image_width":3000,"image_height":2000},{"id":3,"file_url":null,"preview_file_url":"https://cdn/p3.jpg","image_width":1920,"image_height":1080},{"id":4,"file_url":"https://cdn/db4.jpg","preview_file_url":"https://cdn/p4.jpg","image_width":1280,"image_height":720}]"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "danbooru".to_string(),
            keywords: "landscape".to_string(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let items = tauri::async_runtime::block_on(search_danbooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "danbooru-1");
        assert_eq!(items[0].thumb_url, "https://cdn/p1.jpg");
    }

    #[test]
    fn search_danbooru_uses_rating_and_http_error() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":9,"file_url":"https://cdn/db9.jpg","preview_file_url":"https://cdn/p9.jpg","image_width":1920,"image_height":1080}]"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "danbooru".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings {
            rating: Some("sensitive".to_string()),
            ..SourceSettings::default()
        };
        let items = tauri::async_runtime::block_on(search_danbooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source, "danbooru");
    }

    #[test]
    fn search_safebooru_uses_sample_url_when_file_missing() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":7,"sample_url":"https://safebooru.org/samples/s7.jpg","width":2560,"height":1440},{"id":8,"sample_url":"https://safebooru.org/samples/s8.jpg","width":1280,"height":720}]"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "safebooru".to_string(),
            keywords: "scenery".to_string(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let items = tauri::async_runtime::block_on(search_safebooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "safebooru-7");
        assert_eq!(items[0].full_url, "https://safebooru.org/samples/s7.jpg");
    }

    #[test]
    fn search_safebooru_http_error_is_propagated() {
        let server = MockServer::new(vec![(403, "nope", "text/plain")]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "safebooru".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let err = tauri::async_runtime::block_on(search_safebooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap_err();
        assert!(err.contains("safebooru"));
    }

    #[test]
    fn search_safebooru_includes_pid_offset_when_page_gt_one() {
        let server = MockServer::ok(r#"[]"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "safebooru".to_string(),
            keywords: String::new(),
            random: false,
            page: 2,
        };
        let src = SourceSettings::default();
        tauri::async_runtime::block_on(search_safebooru(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("pid=24"), "got: {}", lines[0]);
    }

    #[test]
    fn thumb_hash_is_deterministic_16_hex_chars() {
        let h1 = thumb_hash("https://t/1.jpg");
        let h2 = thumb_hash("https://t/1.jpg");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 16);
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(h1, thumb_hash("https://t/2.jpg"));
    }

    #[test]
    fn mime_for_ext_maps_known_extensions() {
        assert_eq!(mime_for_ext("png"), "image/png");
        assert_eq!(mime_for_ext("webp"), "image/webp");
        assert_eq!(mime_for_ext("gif"), "image/gif");
        assert_eq!(mime_for_ext("jpg"), "image/jpeg");
        assert_eq!(mime_for_ext("unknown"), "image/jpeg");
    }

    fn temp_cache_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "workstation-wall-thumb-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn empty_settings() -> WallpaperSettings {
        WallpaperSettings {
            proxy: None,
            download_dir: None,
            sources: HashMap::new(),
            cache_limit_bytes: None,
            cache_root: None,
            base_urls: HashMap::new(),
        }
    }

    fn state_with(dir: &Path, url: &str) -> ThumbState {
        let state = ThumbState::new(dir.to_path_buf());
        state.register(&[WallpaperItem {
            id: "wallhaven-x".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: url.to_string(),
            thumb_hash: thumb_hash(url),
            full_url: String::new(),
            width: 1920,
            height: 1080,
        }]);
        state
    }

    #[test]
    fn get_or_fetch_downloads_and_caches_on_first_request() {
        let server = MockServer::new(vec![(200, "png-bytes", "image/png")]);
        let dir = temp_cache_dir("first");
        let state = state_with(&dir, &format!("{}/img", server.base_url()));
        let (bytes, mime) = tauri::async_runtime::block_on(state.get_or_fetch(
            &thumb_hash(&format!("{}/img", server.base_url())),
            &empty_settings(),
        ))
        .unwrap();
        assert_eq!(bytes, b"png-bytes");
        assert_eq!(mime, "image/png");
        assert_eq!(server.hit_count(), 1);
        let cached = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().ends_with(".png"));
        assert!(cached, "cache file with .png ext should exist");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_or_fetch_hits_cache_without_network_again() {
        let server = MockServer::new(vec![(200, "img-bytes", "image/jpeg")]);
        let dir = temp_cache_dir("hit");
        let url = format!("{}/img", server.base_url());
        let state = state_with(&dir, &url);
        let hash = thumb_hash(&url);
        tauri::async_runtime::block_on(state.get_or_fetch(&hash, &empty_settings())).unwrap();
        assert_eq!(server.hit_count(), 1);
        let (bytes, mime) =
            tauri::async_runtime::block_on(state.get_or_fetch(&hash, &empty_settings())).unwrap();
        assert_eq!(bytes, b"img-bytes");
        assert_eq!(mime, "image/jpeg");
        assert_eq!(server.hit_count(), 1, "second fetch must not hit network");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_or_fetch_caches_large_body_without_size_limit() {
        let big = "x".repeat(6 * 1024 * 1024);
        let server = MockServer::new(vec![(200, Box::leak(big.into_boxed_str()), "image/jpeg")]);
        let dir = temp_cache_dir("big");
        let url = format!("{}/img", server.base_url());
        let state = state_with(&dir, &url);
        let (bytes, mime) = tauri::async_runtime::block_on(
            state.get_or_fetch(&thumb_hash(&url), &empty_settings()),
        )
        .unwrap();
        assert_eq!(bytes.len(), 6 * 1024 * 1024);
        assert_eq!(mime, "image/jpeg");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_or_fetch_rejects_http_error() {
        let server = MockServer::new(vec![(404, "nope", "text/plain")]);
        let dir = temp_cache_dir("err");
        let url = format!("{}/img", server.base_url());
        let state = state_with(&dir, &url);
        let err = tauri::async_runtime::block_on(
            state.get_or_fetch(&thumb_hash(&url), &empty_settings()),
        )
        .unwrap_err();
        assert!(err.contains("thumb"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_or_fetch_unknown_hash_returns_error() {
        let dir = temp_cache_dir("unknown");
        let state = ThumbState::new(dir.clone());
        let err = tauri::async_runtime::block_on(
            state.get_or_fetch("deadbeefdeadbeef", &empty_settings()),
        )
        .unwrap_err();
        assert!(err.contains("unknown thumb hash"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_or_fetch_applies_pool_limit_and_syncs_index() {
        // 模拟真实布局：pool/{thumbs,full}
        let pool_parent = temp_cache_dir("pool-limit");
        let dir = pool_parent.join(THUMBS_SUBDIR);
        let full_dir = pool_parent.join(FULL_SUBDIR);
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(&full_dir).unwrap();
        // 预置一个超大（sparse）旧 full 文件，超过允许的最小上限（1GB）后最优先淘汰
        let old_full = full_image_cache_path(&pool_parent, "f0000000000000001", "jpg");
        {
            use std::io::Seek;
            let mut f = std::fs::File::create(&old_full).unwrap();
            f.seek(std::io::SeekFrom::Start(
                crate::app_cache::MIN_CACHE_LIMIT_BYTES + 1,
            ))
            .unwrap();
            f.write_all(&[0u8; 1]).unwrap();
        }
        set_mtime(&old_full, 1_000);
        let server = MockServer::new(vec![(200, "th-bytes", "image/jpeg")]);
        let url = format!("{}/img", server.base_url());
        let state = state_with(&dir, &url);
        let hash = thumb_hash(&url);
        let settings = WallpaperSettings {
            cache_limit_bytes: Some(crate::app_cache::MIN_CACHE_LIMIT_BYTES),
            ..empty_settings()
        };
        tauri::async_runtime::block_on(state.get_or_fetch(&hash, &settings)).unwrap();
        // 旧 full 文件被 pool LRU 淘汰
        assert!(!old_full.exists(), "old full file should be evicted");
        // 新 thumb 仍在 index 与磁盘
        assert!(cache_file_path(&dir, &hash, "jpg").exists());
        assert!(state.cached(&hash).is_some());
        let _ = std::fs::remove_dir_all(&pool_parent);
    }

    #[test]
    fn cache_hit_updates_last_access_in_index() {
        let server = MockServer::new(vec![(200, "img-bytes", "image/jpeg")]);
        let dir = temp_cache_dir("touch");
        let url = format!("{}/img", server.base_url());
        let state = state_with(&dir, &url);
        let hash = thumb_hash(&url);
        tauri::async_runtime::block_on(state.get_or_fetch(&hash, &empty_settings())).unwrap();
        let before = {
            let index = state.index.read().unwrap();
            index.get(&hash).unwrap().last_access_ms
        };
        std::thread::sleep(std::time::Duration::from_millis(5));
        tauri::async_runtime::block_on(state.get_or_fetch(&hash, &empty_settings())).unwrap();
        let after = {
            let index = state.index.read().unwrap();
            index.get(&hash).unwrap().last_access_ms
        };
        assert!(after > before, "last_access_ms must increase on hit");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforce_cache_limit_evicts_oldest_beyond_capacity() {
        let pool = temp_cache_dir("lru");
        let thumbs = thumbs_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        for i in 0..3 {
            let hash = format!("h{i:016x}");
            let path = cache_file_path(&thumbs, &hash, "jpg");
            std::fs::write(&path, vec![0u8; 100]).unwrap();
            set_mtime(&path, 1_000 + i * 1000);
        }
        let removed = enforce_cache_limit(&pool, 250);
        assert_eq!(removed.len(), 1, "evict just enough to fit capacity");
        assert!(!cache_file_path(&thumbs, "h0000000000000000", "jpg").exists());
        assert!(cache_file_path(&thumbs, "h0000000000000001", "jpg").exists());
        assert!(cache_file_path(&thumbs, "h0000000000000002", "jpg").exists());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn enforce_cache_limit_keeps_files_when_under_limit() {
        let pool = temp_cache_dir("lru-under");
        let thumbs = thumbs_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        let path = cache_file_path(&thumbs, "h0000000000000000", "jpg");
        std::fs::write(&path, vec![0u8; 10]).unwrap();
        let removed = enforce_cache_limit(&pool, 250);
        assert!(removed.is_empty());
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn enforce_cache_limit_covers_thumbs_and_full_dirs() {
        let pool = temp_cache_dir("lru-both");
        let thumbs = thumbs_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        let full = full_cache_dir(&pool);
        fs::create_dir_all(&full).unwrap();
        let thumb_path = cache_file_path(&thumbs, "t0000000000000001", "jpg");
        let full_path = full_image_cache_path(&pool, "f0000000000000002", "png");
        std::fs::write(&thumb_path, vec![0u8; 100]).unwrap();
        std::fs::write(&full_path, vec![0u8; 100]).unwrap();
        set_mtime(&thumb_path, 1_000);
        set_mtime(&full_path, 2_000);
        let removed = enforce_cache_limit(&pool, 150);
        assert_eq!(removed.len(), 1);
        assert!(!thumb_path.exists());
        assert!(full_path.exists(), "newer full file should survive");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_put_and_get_roundtrip() {
        let pool = temp_cache_dir("full-rt");
        full_image_cache_put(&pool, "abc0000000000001", b"img-bytes", "image/png").unwrap();
        let (bytes, mime) = full_image_cache_get(&pool, "abc0000000000001").unwrap();
        assert_eq!(bytes, b"img-bytes");
        assert_eq!(mime, "image/png");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_get_missing_returns_none() {
        let pool = temp_cache_dir("full-miss");
        assert!(full_image_cache_get(&pool, "def0000000000002").is_none());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_put_overwrites_existing_entry() {
        let pool = temp_cache_dir("full-over");
        full_image_cache_put(&pool, "abc0000000000001", b"old", "image/jpeg").unwrap();
        full_image_cache_put(&pool, "abc0000000000001", b"new", "image/png").unwrap();
        let (bytes, mime) = full_image_cache_get(&pool, "abc0000000000001").unwrap();
        assert_eq!(bytes, b"new");
        assert_eq!(mime, "image/png");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_put_failure_propagates() {
        let pool = temp_cache_dir("full-fail");
        let blocker = pool.join(FULL_SUBDIR);
        std::fs::write(&blocker, "i am a file").unwrap();
        assert!(full_image_cache_put(&pool, "abc0000000000001", b"x", "image/jpeg").is_err());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_put_rename_failure_cleans_tmp() {
        let pool = temp_cache_dir("full-rename-fail");
        let dir = full_cache_dir(&pool);
        fs::create_dir_all(&dir).unwrap();
        // 目标路径是已存在目录：rename(file -> dir) 必然失败，tmp 应被清理
        let target_dir = dir.join("abc0000000000001.jpg");
        fs::create_dir_all(&target_dir).unwrap();
        let err = full_image_cache_put(&pool, "abc0000000000001", b"x", "image/jpeg").unwrap_err();
        assert!(err.contains("cannot rename full cache tmp"));
        // tmp 文件被清理，目录保留
        let leftover: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftover.is_empty(), "tmp file should be cleaned up");
        assert!(target_dir.exists());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_put_skips_stale_cleanup_when_dir_unreadable() {
        let pool = temp_cache_dir("full-noread");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = full_cache_dir(&pool);
            fs::create_dir_all(&dir).unwrap();
            // 只写不可读：写入 tmp/rename 正常，read_dir 失败时静默跳过清理
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o300)).unwrap();
            full_image_cache_put(&pool, "abc0000000000001", b"x", "image/jpeg").unwrap();
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
            assert!(full_image_cache_get(&pool, "abc0000000000001").is_some());
        }
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_put_removes_stale_extension_on_rewrite() {
        let pool = temp_cache_dir("full-stale-ext");
        full_image_cache_put(&pool, "abc0000000000001", b"old", "image/jpeg").unwrap();
        // 重写为 png：旧 jpg 条目应被移除
        full_image_cache_put(&pool, "abc0000000000001", b"new", "image/png").unwrap();
        let (bytes, mime) = full_image_cache_get(&pool, "abc0000000000001").unwrap();
        assert_eq!(bytes, b"new");
        assert_eq!(mime, "image/png");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn enforce_cache_limit_skips_meta_nonfile_and_bad_metadata() {
        let pool = temp_cache_dir("lru-skip");
        let thumbs = thumbs_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        // meta 文件跳过
        std::fs::write(thumbs.join(CACHE_META_FILE), "{}").unwrap();
        // 子目录跳过
        std::fs::create_dir_all(thumbs.join("sub")).unwrap();
        // 常规文件计入
        let normal = cache_file_path(&thumbs, "a0000000000000001", "jpg");
        std::fs::write(&normal, vec![0u8; 10]).unwrap();
        // broken symlink：metadata 失败，跳过
        #[cfg(unix)]
        std::os::unix::fs::symlink("nonexistent-target", thumbs.join("broken.png")).unwrap();
        let removed = enforce_cache_limit(&pool, 5);
        assert_eq!(
            removed.len(),
            1,
            "only normal file beyond capacity is evicted"
        );
        assert!(!normal.exists());
        assert!(thumbs.join(CACHE_META_FILE).exists());
        assert!(thumbs.join("sub").exists());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_size_skips_meta_and_dirs() {
        let pool = temp_cache_dir("size-skip");
        let thumbs = thumbs_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        std::fs::write(thumbs.join(CACHE_META_FILE), "{}").unwrap();
        fs::create_dir_all(thumbs.join("dir.png")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("nonexistent-target", thumbs.join("broken.png")).unwrap();
        std::fs::write(
            cache_file_path(&thumbs, "b0000000000000001", "png"),
            vec![0u8; 7],
        )
        .unwrap();
        let (total, thumb, full_bytes) = full_image_cache_size(&pool);
        assert_eq!(thumb, 7);
        assert_eq!(full_bytes, 0);
        assert_eq!(total, 7);
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn clear_wallpaper_cache_propagates_remove_error() {
        let pool = temp_cache_dir("clear-err");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let full = full_cache_dir(&pool);
            fs::create_dir_all(&full).unwrap();
            let file = full_image_cache_path(&pool, "c0000000000000001", "png");
            std::fs::write(&file, b"x").unwrap();
            // 只读目录使 remove_file 失败
            fs::set_permissions(&full, fs::Permissions::from_mode(0o500)).unwrap();
            assert!(clear_wallpaper_cache(&pool).is_err());
            fs::set_permissions(&full, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn full_image_cache_size_breaks_down_by_subdir() {
        let pool = temp_cache_dir("size");
        let thumbs = thumbs_cache_dir(&pool);
        let full = full_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        fs::create_dir_all(&full).unwrap();
        std::fs::write(
            cache_file_path(&thumbs, "t0000000000000001", "jpg"),
            vec![0u8; 10],
        )
        .unwrap();
        std::fs::write(
            full_image_cache_path(&pool, "f0000000000000002", "png"),
            vec![0u8; 20],
        )
        .unwrap();
        let (total, thumb, full_bytes) = full_image_cache_size(&pool);
        assert_eq!(thumb, 10);
        assert_eq!(full_bytes, 20);
        assert_eq!(total, 30);
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn clear_wallpaper_cache_removes_cache_files_only() {
        let pool = temp_cache_dir("clear");
        let thumbs = thumbs_cache_dir(&pool);
        let full = full_cache_dir(&pool);
        fs::create_dir_all(&thumbs).unwrap();
        fs::create_dir_all(&full).unwrap();
        let thumb_path = cache_file_path(&thumbs, "t0000000000000001", "jpg");
        let full_path = full_image_cache_path(&pool, "f0000000000000002", "png");
        std::fs::write(&thumb_path, b"a").unwrap();
        std::fs::write(&full_path, b"bb").unwrap();
        std::fs::write(thumbs.join(CACHE_META_FILE), "{}").unwrap();
        // 非文件条目（子目录）不被删除
        fs::create_dir_all(full.join("subdir.png")).unwrap();
        clear_wallpaper_cache(&pool).unwrap();
        assert!(!thumb_path.exists());
        assert!(!full_path.exists());
        assert!(thumbs.join(CACHE_META_FILE).exists(), "meta preserved");
        assert!(full.join("subdir.png").exists(), "subdir not touched");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn clear_wallpaper_cache_missing_dirs_is_ok() {
        let pool = temp_cache_dir("clear-miss");
        assert!(clear_wallpaper_cache(&pool).is_ok());
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn cache_limit_clamps_to_range_and_default() {
        use crate::app_cache::{
            DEFAULT_CACHE_LIMIT_BYTES, MAX_CACHE_LIMIT_BYTES, MIN_CACHE_LIMIT_BYTES,
        };
        assert_eq!(
            WallpaperSettings::default().cache_limit(),
            DEFAULT_CACHE_LIMIT_BYTES
        );
        let small = WallpaperSettings {
            cache_limit_bytes: Some(1),
            ..WallpaperSettings::default()
        };
        assert_eq!(small.cache_limit(), MIN_CACHE_LIMIT_BYTES);
        let huge = WallpaperSettings {
            cache_limit_bytes: Some(999_999_999_999),
            ..WallpaperSettings::default()
        };
        assert_eq!(huge.cache_limit(), MAX_CACHE_LIMIT_BYTES);
        let exact = WallpaperSettings {
            cache_limit_bytes: Some(5_000_000_000),
            ..WallpaperSettings::default()
        };
        assert_eq!(exact.cache_limit(), 5_000_000_000);
    }

    #[test]
    fn full_image_cache_path_joins_full_subdir() {
        let pool = Path::new("/pool");
        assert_eq!(
            full_image_cache_path(pool, "abc0000000000001", "png"),
            PathBuf::from("/pool/full/abc0000000000001.png")
        );
    }

    #[test]
    fn hash_from_cache_path_parses_hash_and_ext() {
        assert_eq!(
            hash_from_cache_path(Path::new("/a/b/abc0000000000001.png")),
            Some("abc0000000000001".to_string())
        );
        assert_eq!(hash_from_cache_path(Path::new("/a/b/noext")), None);
    }

    #[test]
    fn load_thumb_index_rebuilds_from_directory_when_corrupted() {
        let dir = temp_cache_dir("rebuild");
        std::fs::write(dir.join(CACHE_META_FILE), "not json").unwrap();
        std::fs::write(cache_file_path(&dir, "h0000000000000001", "png"), "abc").unwrap();
        std::fs::write(cache_file_path(&dir, "h0000000000000002", "jpg"), "defg").unwrap();
        let index = load_thumb_index(&dir);
        assert_eq!(index.len(), 2);
        assert_eq!(index["h0000000000000001"].ext, "png");
        assert_eq!(index["h0000000000000001"].size, 3);
        assert_eq!(index["h0000000000000002"].ext, "jpg");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_thumb_index_reads_valid_meta() {
        let dir = temp_cache_dir("index-load");
        let mut idx = ThumbIndex::new();
        idx.insert(
            "cafe0000000000001".to_string(),
            ThumbMetaEntry {
                url: "https://t/1.jpg".to_string(),
                size: 3,
                ext: "png".to_string(),
                last_access_ms: 42,
            },
        );
        save_thumb_index(&dir, &idx);
        let loaded = load_thumb_index(&dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded["cafe0000000000001"].ext, "png");
        assert_eq!(loaded["cafe0000000000001"].size, 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn thumb_state_new_with_missing_dir_is_empty() {
        let dir = std::env::temp_dir().join(format!(
            "workstation-wall-thumb-nodir-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let state = ThumbState::new(dir.clone());
        assert!(state.resolve("anything").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rebuild_thumb_index_skips_unrelated_entries() {
        let dir = temp_cache_dir("rebuild-skip");
        std::fs::write(dir.join("noext"), "x").unwrap();
        std::fs::write(dir.join(".jpg"), "x").unwrap();
        std::fs::write(dir.join("hash1234567890.verylong"), "x").unwrap();
        std::fs::write(dir.join(CACHE_META_FILE), "{}").unwrap();
        std::fs::create_dir(dir.join("dir.png")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("nonexistent-target", dir.join("broken.png")).unwrap();
        std::fs::write(cache_file_path(&dir, "cafe0000000000001", "png"), "abc").unwrap();
        let index = rebuild_thumb_index(&dir);
        assert_eq!(index.len(), 1);
        assert_eq!(index["cafe0000000000001"].ext, "png");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_returns_none_when_index_entry_file_missing() {
        let dir = temp_cache_dir("cached-missing");
        let state = ThumbState::new(dir.clone());
        state.index.write().unwrap().insert(
            "deadbeef00000000".to_string(),
            ThumbMetaEntry {
                url: "u".to_string(),
                size: 1,
                ext: "jpg".to_string(),
                last_access_ms: 1,
            },
        );
        assert!(state.cached("deadbeef00000000").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn request_lines_waits_for_pending_requests() {
        let server = MockServer::ok("[]");
        let addr = server.base_url().trim_start_matches("http://").to_string();
        let hanging = std::thread::spawn(move || {
            let mut stream = std::net::TcpStream::connect(&addr).unwrap();
            let _ = stream.write_all(b"GET /hang");
            std::thread::sleep(std::time::Duration::from_millis(150));
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        let mut stream =
            std::net::TcpStream::connect(server.base_url().trim_start_matches("http://")).unwrap();
        let _ = stream.write_all(b"GET /ok HTTP/1.1\r\nHost: x\r\n\r\n");
        let lines = server.request_lines();
        assert!(!lines.is_empty());
        hanging.join().unwrap();
    }

    #[test]
    fn register_lazy_prunes_stale_cache_files() {
        let dir = temp_cache_dir("lazy");
        std::fs::write(cache_file_path(&dir, "stale000000000000", "jpg"), "x").unwrap();
        std::fs::write(cache_file_path(&dir, "deadbeef00000000", "png"), "y").unwrap();
        let state = ThumbState::new(dir.clone());
        let url = "https://t/live.jpg";
        let hash = thumb_hash(url);
        state.register(&[WallpaperItem {
            id: "wallhaven-live".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: url.to_string(),
            thumb_hash: hash.clone(),
            full_url: String::new(),
            width: 1920,
            height: 1080,
        }]);
        assert!(!cache_file_path(&dir, "stale000000000000", "jpg").exists());
        assert!(!cache_file_path(&dir, "deadbeef00000000", "png").exists());
        assert_eq!(state.resolve(&hash), Some(url.to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn download_wallpaper_writes_file_and_returns_path() {
        let server = MockServer::new(vec![(200, "fake-image-bytes", "image/jpeg")]);
        let dir = std::env::temp_dir().join(format!("workstation-wall-dl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let item = WallpaperItem {
            id: "wallhaven-test123".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: format!("{}/img", server.base_url()),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings {
            proxy: None,
            download_dir: Some(dir.display().to_string()),
            sources: HashMap::new(),
            cache_limit_bytes: None,
            cache_root: None,
            base_urls: HashMap::new(),
        };
        let path = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap();
        assert!(path.ends_with("wallhaven-test123.jpg"));
        assert_eq!(read_body(Path::new(&path)), "fake-image-bytes");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn download_wallpaper_derives_extension_from_content_type() {
        let server = MockServer::new(vec![(200, "png-bytes", "image/png")]);
        let dir =
            std::env::temp_dir().join(format!("workstation-wall-dl-png-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let item = WallpaperItem {
            id: "danbooru-42".to_string(),
            source: "danbooru".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: format!("{}/img", server.base_url()),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings {
            proxy: None,
            download_dir: Some(dir.display().to_string()),
            sources: HashMap::new(),
            cache_limit_bytes: None,
            cache_root: None,
            base_urls: HashMap::new(),
        };
        let path = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap();
        assert!(path.ends_with("danbooru-42.png"));
        assert_eq!(read_body(Path::new(&path)), "png-bytes");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn download_wallpaper_uses_cache_when_full_image_hit() {
        let pool = temp_cache_dir("dl-cache-hit");
        let server = MockServer::new(vec![(200, "cached-dl-bytes", "image/png")]);
        let item = WallpaperItem {
            id: "wallhaven-cached1".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: format!("{}/img", server.base_url()),
            width: 1920,
            height: 1080,
        };
        let dl_dir =
            std::env::temp_dir().join(format!("workstation-wall-dl-cached-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dl_dir);
        let settings = WallpaperSettings {
            download_dir: Some(dl_dir.display().to_string()),
            cache_root: Some(pool.display().to_string()),
            ..WallpaperSettings::default()
        };
        // 先拉一次进缓存
        tauri::async_runtime::block_on(fetch_full_image(item.clone(), settings.clone())).unwrap();
        assert_eq!(server.hit_count(), 1);
        // 下载应命中缓存，零网络
        let path = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap();
        assert!(path.ends_with("wallhaven-cached1.png"));
        assert_eq!(read_body(Path::new(&path)), "cached-dl-bytes");
        assert_eq!(server.hit_count(), 1, "download must reuse cache");
        let _ = std::fs::remove_dir_all(&pool);
        let _ = std::fs::remove_dir_all(&dl_dir);
    }

    #[test]
    fn download_wallpaper_http_error_is_propagated() {
        let server = MockServer::new(vec![(500, "boom", "text/plain")]);
        let item = WallpaperItem {
            id: "x-1".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: format!("{}/img", server.base_url()),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings::default();
        let err = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap_err();
        assert!(err.contains("full image"));
    }

    #[test]
    fn download_wallpaper_network_error_is_propagated() {
        let item = WallpaperItem {
            id: "x-2".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: "http://127.0.0.1:1/unreachable".to_string(),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings::default();
        let err = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap_err();
        assert!(err.contains("request failed"));
    }

    #[test]
    fn download_wallpaper_bad_proxy_is_propagated() {
        let item = WallpaperItem {
            id: "x-3".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: "https://example.com/img.jpg".to_string(),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings {
            proxy: Some("not a proxy url".to_string()),
            ..WallpaperSettings::default()
        };
        let err = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap_err();
        assert!(err.contains("invalid proxy"));
    }

    #[test]
    fn download_wallpaper_create_dir_error_is_propagated() {
        let blocker = std::env::temp_dir().join(format!(
            "workstation-wall-dl-dir-blocker-{}",
            std::process::id()
        ));
        std::fs::write(&blocker, "i am a file").unwrap();
        let server = MockServer::ok("bytes");
        let item = WallpaperItem {
            id: "x-4".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: format!("{}/img", server.base_url()),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings {
            download_dir: Some(blocker.join("nested").display().to_string()),
            ..WallpaperSettings::default()
        };
        let err = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap_err();
        assert!(err.contains("cannot create download dir"));
        let _ = std::fs::remove_file(&blocker);
    }

    #[test]
    fn download_wallpaper_no_content_type_defaults_jpg() {
        let server = MockServer::new(vec![(200, "bytes", "")]);
        let dir =
            std::env::temp_dir().join(format!("workstation-wall-dl-noct-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let item = WallpaperItem {
            id: "safebooru-99".to_string(),
            source: "safebooru".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: format!("{}/img", server.base_url()),
            width: 1920,
            height: 1080,
        };
        let settings = WallpaperSettings {
            download_dir: Some(dir.display().to_string()),
            ..WallpaperSettings::default()
        };
        let path = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap();
        assert!(path.ends_with("safebooru-99.jpg"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_wallpapers_uses_per_source_settings() {
        let server = MockServer::new(vec![(
            200,
            r#"{"data":[{"id":"zz","path":"https://img/z.jpg","thumbs":{"small":"https://t/z.jpg"},"dimension_x":3840,"dimension_y":2160}]}"#,
            "application/json",
        )]);
        let mut settings = settings_with_sources(
            None,
            &[(
                "wallhaven",
                r#"{"apiKey":"secret","purity":"111","categories":"111"}"#,
            )],
        );
        settings
            .base_urls
            .insert("wallhaven".to_string(), server.base_url());
        let result = search_wallpapers(
            SearchQuery {
                source: "wallhaven".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        );
        let items = tauri::async_runtime::block_on(result).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(server.hit_count(), 1);
    }

    #[test]
    fn search_wallpapers_dispatch_danbooru() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":1,"file_url":"https://cdn/db1.jpg","preview_file_url":"https://cdn/p1.jpg","image_width":1920,"image_height":1080}]"#,
            "application/json",
        )]);
        let mut settings = WallpaperSettings::default();
        settings
            .base_urls
            .insert("danbooru".to_string(), server.base_url());
        let items = tauri::async_runtime::block_on(search_wallpapers(
            SearchQuery {
                source: "danbooru".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source, "danbooru");
    }

    #[test]
    fn search_wallpapers_dispatch_safebooru() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":7,"sample_url":"https://safebooru.org/samples/s7.jpg","width":1920,"height":1080}]"#,
            "application/json",
        )]);
        let mut settings = WallpaperSettings::default();
        settings
            .base_urls
            .insert("safebooru".to_string(), server.base_url());
        let items = tauri::async_runtime::block_on(search_wallpapers(
            SearchQuery {
                source: "safebooru".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source, "safebooru");
    }

    #[test]
    fn search_danbooru_includes_page_param_when_gt_one() {
        let server = MockServer::ok(r#"[]"#);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "danbooru".to_string(),
            keywords: String::new(),
            random: false,
            page: 3,
        };
        let src = SourceSettings::default();
        tauri::async_runtime::block_on(search_danbooru(&client, &query, &src, &server.base_url()))
            .unwrap();
        let lines = server.request_lines();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("page=3"), "got: {}", lines[0]);
    }

    #[test]
    fn search_wallpapers_invalid_base_url_is_error() {
        let mut settings = WallpaperSettings::default();
        settings
            .base_urls
            .insert("wallhaven".to_string(), "not a url".to_string());
        let err = tauri::async_runtime::block_on(search_wallpapers(
            SearchQuery {
                source: "wallhaven".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        ))
        .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn search_wallpapers_danbooru_invalid_base_url_is_error() {
        let mut settings = WallpaperSettings::default();
        settings
            .base_urls
            .insert("danbooru".to_string(), "not a url".to_string());
        let err = tauri::async_runtime::block_on(search_wallpapers(
            SearchQuery {
                source: "danbooru".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        ))
        .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn search_wallpapers_safebooru_invalid_base_url_is_error() {
        let mut settings = WallpaperSettings::default();
        settings
            .base_urls
            .insert("safebooru".to_string(), "not a url".to_string());
        let err = tauri::async_runtime::block_on(search_wallpapers(
            SearchQuery {
                source: "safebooru".to_string(),
                keywords: String::new(),
                random: false,
                ..Default::default()
            },
            settings,
        ))
        .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn search_danbooru_random_and_basic_auth() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":5,"file_url":"https://cdn/db5.jpg","preview_file_url":"https://cdn/p5.jpg","image_width":1920,"image_height":1080}]"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "danbooru".to_string(),
            keywords: String::new(),
            random: true,
            ..Default::default()
        };
        let src = SourceSettings {
            login: Some("me".to_string()),
            api_key: Some("key".to_string()),
            ..SourceSettings::default()
        };
        let items = tauri::async_runtime::block_on(search_danbooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(server.hit_count(), 1);
    }

    #[test]
    fn search_danbooru_http_error_is_propagated() {
        let server = MockServer::new(vec![(403, "denied", "text/plain")]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "danbooru".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let err = tauri::async_runtime::block_on(search_danbooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap_err();
        assert!(err.contains("danbooru"));
    }

    #[test]
    fn search_danbooru_skips_missing_urls() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":3,"file_url":null,"preview_file_url":null,"image_width":1920,"image_height":1080},{"id":4,"file_url":"https://cdn/db4.jpg","preview_file_url":null,"image_width":1920,"image_height":1080}]"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "danbooru".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let items = tauri::async_runtime::block_on(search_danbooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn search_safebooru_skips_missing_urls() {
        let server = MockServer::new(vec![(
            200,
            r#"[{"id":8,"width":1920,"height":1080}]"#,
            "application/json",
        )]);
        let client = build_client(None).unwrap();
        let query = SearchQuery {
            source: "safebooru".to_string(),
            keywords: String::new(),
            random: false,
            ..Default::default()
        };
        let src = SourceSettings::default();
        let items = tauri::async_runtime::block_on(search_safebooru(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn source_settings_default_to_empty() {
        let settings = WallpaperSettings::default();
        assert!(settings.source("wallhaven").api_key.is_none());
        assert!(settings.source("wallhaven").purity.is_none());
        assert!(settings.source("danbooru").login.is_none());
    }

    #[test]
    fn source_settings_parse_camel_case_fields() {
        let json = r#"{
            "proxy": "http://127.0.0.1:7890",
            "downloadDir": "/tmp",
            "sources": {
                "wallhaven": {
                    "apiKey": "secret",
                    "purity": "110",
                    "categories": "111",
                    "minWidth": 2560,
                    "minHeight": 1440
                },
                "danbooru": {
                    "login": "me",
                    "apiKey": "db-key",
                    "rating": "sensitive"
                }
            }
        }"#;
        let settings: WallpaperSettings =
            serde_json::from_str(json).expect("settings should parse");
        assert_eq!(settings.download_dir.as_deref(), Some("/tmp"));
        assert_eq!(settings.proxy.as_deref(), Some("http://127.0.0.1:7890"));
        let wh = settings.source("wallhaven");
        assert_eq!(wh.api_key.as_deref(), Some("secret"));
        assert_eq!(wh.purity.as_deref(), Some("110"));
        assert_eq!(wh.categories.as_deref(), Some("111"));
        assert_eq!(wh.min_width, Some(2560));
        assert_eq!(wh.min_height, Some(1440));
        let db = settings.source("danbooru");
        assert_eq!(db.login.as_deref(), Some("me"));
        assert_eq!(db.api_key.as_deref(), Some("db-key"));
        assert_eq!(db.rating.as_deref(), Some("sensitive"));
        assert!(settings.source("safebooru").api_key.is_none());
    }

    #[test]
    fn source_settings_parse_string_dimensions_from_frontend() {
        let json = r#"{
            "proxy": "http://127.0.0.1:7890",
            "sources": {
                "wallhaven": {
                    "apiKey": "2DsBL7QRs1bRE2QkKraRqL0v5w7PWkA2",
                    "categories": "010",
                    "purity": "010",
                    "minWidth": "1920",
                    "minHeight": "1080",
                    "rating": "safe"
                },
                "safebooru": {
                    "minWidth": "1920",
                    "minHeight": ""
                }
            }
        }"#;
        let settings: WallpaperSettings =
            serde_json::from_str(json).expect("frontend string format should parse");
        assert_eq!(settings.proxy.as_deref(), Some("http://127.0.0.1:7890"));
        let wh = settings.source("wallhaven");
        assert_eq!(
            wh.api_key.as_deref(),
            Some("2DsBL7QRs1bRE2QkKraRqL0v5w7PWkA2")
        );
        assert_eq!(wh.purity.as_deref(), Some("010"));
        assert_eq!(wh.min_width, Some(1920));
        assert_eq!(wh.min_height, Some(1080));
        let sf = settings.source("safebooru");
        assert_eq!(sf.min_width, Some(1920));
        assert_eq!(sf.min_height, None);
    }

    #[test]
    fn de_u32_string_handles_missing_and_invalid_values() {
        let invalid_str = r#"{
            "sources": {
                "wallhaven": {
                    "minWidth": "not-a-number"
                }
            }
        }"#;
        let err = serde_json::from_str::<WallpaperSettings>(invalid_str).unwrap_err();
        assert!(err.to_string().contains("invalid u32 string"));

        let other_type = r#"{
            "sources": {
                "wallhaven": {
                    "minHeight": true
                }
            }
        }"#;
        let err = serde_json::from_str::<WallpaperSettings>(other_type).unwrap_err();
        assert!(err
            .to_string()
            .contains("expected number or numeric string"));

        let json = r#"{
            "sources": {
                "wallhaven": {
                    "minWidth": null
                }
            }
        }"#;
        let settings: WallpaperSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.source("wallhaven").min_width, None);
    }

    /// 按原始响应字符串原样回应的服务器，用于模拟缺失 Content-Type 或截断 body 等场景。
    /// 测试调用方必定发起连接，accept 失败视为测试错误直接 panic（避免 if-let 分支导致覆盖率下降）。
    fn serve_raw(response: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request_line = String::new();
            let _ = reader.read_line(&mut request_line);
            for line in reader.by_ref().lines() {
                let line = line.unwrap();
                if line.is_empty() {
                    break;
                }
            }
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        });
        format!("http://{addr}")
    }

    fn full_image_item(url: String) -> WallpaperItem {
        WallpaperItem {
            id: "wallhaven-full1".to_string(),
            source: "wallhaven".to_string(),
            thumb_url: String::new(),
            thumb_hash: String::new(),
            full_url: url,
            width: 1920,
            height: 1080,
        }
    }

    #[test]
    fn fetch_full_image_returns_bytes_and_mime() {
        let server = MockServer::new(vec![(200, "full-image-bytes", "image/png")]);
        let item = full_image_item(format!("{}/full", server.base_url()));
        let (bytes, mime) =
            tauri::async_runtime::block_on(fetch_full_image(item, WallpaperSettings::default()))
                .unwrap();
        assert_eq!(bytes, b"full-image-bytes");
        assert_eq!(mime, "image/png");
        assert_eq!(server.hit_count(), 1);
    }

    #[test]
    fn fetch_full_image_hits_cache_without_network() {
        let pool = temp_cache_dir("full-cache-hit");
        let server = MockServer::new(vec![(200, "cached-bytes", "image/png")]);
        let item = full_image_item(format!("{}/full", server.base_url()));
        let settings = WallpaperSettings {
            cache_root: Some(pool.display().to_string()),
            ..WallpaperSettings::default()
        };
        let (bytes, mime) =
            tauri::async_runtime::block_on(fetch_full_image(item.clone(), settings.clone()))
                .unwrap();
        assert_eq!(bytes, b"cached-bytes");
        assert_eq!(mime, "image/png");
        assert_eq!(server.hit_count(), 1);
        assert!(full_image_cache_get(&pool, &thumb_hash(&item.full_url)).is_some());
        // 第二次请求应命中缓存，零网络
        let (bytes2, mime2) =
            tauri::async_runtime::block_on(fetch_full_image(item, settings)).unwrap();
        assert_eq!(bytes2, b"cached-bytes");
        assert_eq!(mime2, "image/png");
        assert_eq!(server.hit_count(), 1, "cache hit must not hit network");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn fetch_full_image_cache_put_failure_still_returns_bytes() {
        let pool = temp_cache_dir("full-cache-put-fail");
        let blocker = pool.join(FULL_SUBDIR);
        std::fs::write(&blocker, "i am a file").unwrap();
        let server = MockServer::new(vec![(200, "bytes-ok", "image/jpeg")]);
        let item = full_image_item(format!("{}/img", server.base_url()));
        let settings = WallpaperSettings {
            cache_root: Some(pool.display().to_string()),
            ..WallpaperSettings::default()
        };
        let (bytes, mime) =
            tauri::async_runtime::block_on(fetch_full_image(item, settings)).unwrap();
        assert_eq!(bytes, b"bytes-ok");
        assert_eq!(mime, "image/jpeg");
        let _ = std::fs::remove_dir_all(&pool);
    }

    #[test]
    fn fetch_full_image_derives_mime_from_webp_content_type() {
        let server = MockServer::new(vec![(200, "webp-bytes", "image/webp")]);
        let item = full_image_item(format!("{}/full", server.base_url()));
        let (bytes, mime) =
            tauri::async_runtime::block_on(fetch_full_image(item, WallpaperSettings::default()))
                .unwrap();
        assert_eq!(bytes, b"webp-bytes");
        assert_eq!(mime, "image/webp");
    }

    #[test]
    fn fetch_full_image_http_error_is_propagated() {
        let server = MockServer::new(vec![(403, "nope", "text/plain")]);
        let item = full_image_item(format!("{}/full", server.base_url()));
        let err =
            tauri::async_runtime::block_on(fetch_full_image(item, WallpaperSettings::default()))
                .unwrap_err();
        assert!(err.contains("full image"));
        assert!(err.contains("HTTP 403"));
    }

    #[test]
    fn fetch_full_image_network_error_is_propagated() {
        let item = full_image_item("http://127.0.0.1:1/unreachable".to_string());
        let err =
            tauri::async_runtime::block_on(fetch_full_image(item, WallpaperSettings::default()))
                .unwrap_err();
        assert!(err.contains("full image request failed"));
    }

    #[test]
    fn fetch_full_image_bad_proxy_is_propagated() {
        let item = full_image_item("https://example.com/full.jpg".to_string());
        let settings = WallpaperSettings {
            proxy: Some("not a proxy url".to_string()),
            ..WallpaperSettings::default()
        };
        let err = tauri::async_runtime::block_on(fetch_full_image(item, settings)).unwrap_err();
        assert!(err.contains("invalid proxy"));
    }

    #[test]
    fn fetch_full_image_missing_content_type_falls_back_to_jpeg() {
        let base =
            serve_raw("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nbytes");
        let item = full_image_item(format!("{base}/full"));
        let (bytes, mime) =
            tauri::async_runtime::block_on(fetch_full_image(item, WallpaperSettings::default()))
                .unwrap();
        assert_eq!(bytes, b"bytes");
        assert_eq!(mime, "image/jpeg");
    }

    #[test]
    fn fetch_full_image_body_read_error_is_propagated() {
        let base = serve_raw(
            "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: 100\r\nConnection: close\r\n\r\nshort",
        );
        let item = full_image_item(format!("{base}/full"));
        let err =
            tauri::async_runtime::block_on(fetch_full_image(item, WallpaperSettings::default()))
                .unwrap_err();
        assert!(err.contains("body read failed"));
    }

    #[test]
    fn full_image_data_url_builds_base64_data_url() {
        let url = full_image_data_url(b"hello", "image/jpeg");
        assert_eq!(url, "data:image/jpeg;base64,aGVsbG8=");
    }

    #[test]
    fn full_image_data_url_handles_empty_bytes_and_other_mime() {
        let url = full_image_data_url(b"", "image/png");
        assert_eq!(url, "data:image/png;base64,");
    }

    #[test]
    fn mime_from_content_type_maps_common_types() {
        assert_eq!(mime_from_content_type("image/gif"), "image/gif");
        assert_eq!(
            mime_from_content_type("application/octet-stream"),
            "image/jpeg"
        );
    }

    fn write_png(path: &Path, width: u32, height: u32) {
        use image::ImageEncoder;
        let mut buf = Vec::new();
        let img = image::RgbImage::from_pixel(width, height, image::Rgb([10, 20, 30]));
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(img.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .unwrap();
        fs::write(path, buf).unwrap();
    }

    fn set_mtime(path: &Path, millis: u64) {
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_millis(millis);
        let _ = filetime::set_file_mtime(path, filetime::FileTime::from_system_time(t));
    }

    #[test]
    fn is_image_file_name_matches_known_extensions_case_insensitively() {
        assert!(is_image_file_name("wallhaven-123.jpg"));
        assert!(is_image_file_name("photo.JPEG"));
        assert!(is_image_file_name("pic.png"));
        assert!(is_image_file_name("anim.webp"));
        assert!(is_image_file_name("anim.gif"));
        assert!(is_image_file_name("bitmap.bmp"));
        assert!(!is_image_file_name("notes.txt"));
        assert!(!is_image_file_name("archive.zip"));
        assert!(!is_image_file_name("wallpaper.jpg.bak"));
        assert!(!is_image_file_name("noext"));
    }

    #[test]
    fn wallpapers_dir_prefers_settings_download_dir() {
        let settings = WallpaperSettings {
            download_dir: Some("  /custom/dir  ".to_string()),
            ..WallpaperSettings::default()
        };
        assert_eq!(wallpapers_dir(&settings), PathBuf::from("  /custom/dir  "));
    }

    #[test]
    fn wallpapers_dir_falls_back_to_default_when_unset_or_empty() {
        let empty = WallpaperSettings {
            download_dir: Some("   ".to_string()),
            ..WallpaperSettings::default()
        };
        assert_eq!(wallpapers_dir(&empty), default_download_dir());
        assert_eq!(
            wallpapers_dir(&WallpaperSettings::default()),
            default_download_dir()
        );
    }

    #[test]
    fn local_wallpaper_entries_lists_only_image_files() {
        let dir = temp_cache_dir("local-entries");
        let img = dir.join("a.png");
        let txt = dir.join("b.txt");
        write_png(&img, 8, 8);
        fs::write(&txt, "hi").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        let entries = local_wallpaper_entries(&dir);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, img);
        assert_eq!(entries[0].size_bytes, fs::metadata(&img).unwrap().len());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn local_wallpaper_entries_missing_dir_returns_empty() {
        let dir = temp_cache_dir("local-entries-missing").join("nope");
        assert!(local_wallpaper_entries(&dir).is_empty());
    }

    #[test]
    fn local_wallpaper_entries_reads_modified_time() {
        let dir = temp_cache_dir("local-entries-mtime");
        let img = dir.join("c.png");
        write_png(&img, 8, 8);
        set_mtime(&img, 1_700_000_000_000);
        let entries = local_wallpaper_entries(&dir);
        assert_eq!(entries[0].modified_ms, 1_700_000_000_000);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_local_wallpapers_with_sorts_by_modified_desc_and_builds_info() {
        let dir = temp_cache_dir("local-list");
        let older = dir.join("older.png");
        let newer = dir.join("newer.png");
        write_png(&older, 8, 8);
        write_png(&newer, 8, 8);
        set_mtime(&older, 1_600_000_000_000);
        set_mtime(&newer, 1_700_000_000_000);
        let result = list_local_wallpapers_with(&dir, local_wallpaper_entries, |p| {
            if p.file_name().unwrap() == "older.png" {
                None
            } else {
                Some("data:image/jpeg;base64,abc".to_string())
            }
        });
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].file_name, "newer.png");
        assert_eq!(result[0].thumb_data_url, "data:image/jpeg;base64,abc");
        assert_eq!(result[1].file_name, "older.png");
        assert_eq!(result[1].thumb_data_url, "");
        assert!(result[0].absolute_path.contains("newer.png"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_local_wallpapers_with_empty_dir_returns_empty() {
        let dir = temp_cache_dir("local-list-empty").join("empty");
        let result = list_local_wallpapers_with(&dir, local_wallpaper_entries, |_| None);
        assert!(result.is_empty());
    }

    #[test]
    fn thumbnail_data_url_scales_down_large_image() {
        let dir = temp_cache_dir("local-thumb-large");
        let img = dir.join("big.png");
        write_png(&img, 1600, 800);
        let url = thumbnail_data_url(&img, 400).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(url.split(',').nth(1).unwrap())
            .unwrap();
        let loaded = image::load_from_memory(&decoded).unwrap();
        assert_eq!(loaded.width(), 400);
        assert_eq!(loaded.height(), 200);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn thumbnail_data_url_keeps_small_image_unchanged() {
        let dir = temp_cache_dir("local-thumb-small");
        let img = dir.join("small.png");
        write_png(&img, 100, 50);
        let url = thumbnail_data_url(&img, 400).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(url.split(',').nth(1).unwrap())
            .unwrap();
        let loaded = image::load_from_memory(&decoded).unwrap();
        assert_eq!(loaded.width(), 100);
        assert_eq!(loaded.height(), 50);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn thumbnail_data_url_returns_none_for_missing_or_invalid_file() {
        let dir = temp_cache_dir("local-thumb-invalid");
        let missing = dir.join("missing.png");
        assert!(thumbnail_data_url(&missing, 400).is_none());
        let broken = dir.join("broken.png");
        fs::write(&broken, "not an image").unwrap();
        assert!(thumbnail_data_url(&broken, 400).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_local_wallpaper_file_returns_png_data_url() {
        let dir = temp_cache_dir("local-read");
        let img = dir.join("read.png");
        write_png(&img, 8, 8);
        let url = read_local_wallpaper_file(&img).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_local_wallpaper_file_missing_returns_error() {
        let dir = temp_cache_dir("local-read-missing");
        let err = read_local_wallpaper_file(&dir.join("nope.png")).unwrap_err();
        assert!(err.contains("cannot read wallpaper file"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_local_wallpaper_file_unknown_format_falls_back_to_jpeg() {
        let dir = temp_cache_dir("local-read-unknown");
        let img = dir.join("unknown.jpg");
        fs::write(&img, "some bytes").unwrap();
        let url = read_local_wallpaper_file(&img).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_local_wallpaper_file_returns_webp_gif_and_other_data_urls() {
        use image::codecs::gif::GifEncoder;
        use image::codecs::webp::WebPEncoder;
        use image::ImageEncoder;
        let dir = temp_cache_dir("local-read-formats");

        let webp = dir.join("anim.webp");
        let mut webp_buf = Vec::new();
        let img = image::RgbImage::from_pixel(4, 4, image::Rgb([1, 2, 3]));
        WebPEncoder::new_lossless(&mut webp_buf)
            .write_image(img.as_raw(), 4, 4, image::ExtendedColorType::Rgb8)
            .unwrap();
        fs::write(&webp, &webp_buf).unwrap();
        let url = read_local_wallpaper_file(&webp).unwrap();
        assert!(url.starts_with("data:image/webp;base64,"));

        let gif = dir.join("anim.gif");
        let mut gif_buf = Vec::new();
        {
            let mut gif_enc = GifEncoder::new(&mut gif_buf);
            gif_enc
                .encode(img.as_raw(), 4, 4, image::ExtendedColorType::Rgb8)
                .unwrap();
        }
        fs::write(&gif, &gif_buf).unwrap();
        let url = read_local_wallpaper_file(&gif).unwrap();
        assert!(url.starts_with("data:image/gif;base64,"));

        let jpg = dir.join("photo.jpg");
        let mut jpg_buf = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpg_buf)
            .encode(img.as_raw(), 4, 4, image::ExtendedColorType::Rgb8)
            .unwrap();
        fs::write(&jpg, &jpg_buf).unwrap();
        let url = read_local_wallpaper_file(&jpg).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_local_wallpapers_with_reports_each_result() {
        let dir = temp_cache_dir("local-delete");
        let a = dir.join("a.png");
        let b = dir.join("b.png");
        write_png(&a, 4, 4);
        write_png(&b, 4, 4);
        let paths = vec![a.display().to_string(), b.display().to_string()];
        let result = delete_local_wallpapers_with(&paths, |p| fs::remove_file(p));
        assert_eq!(result.deleted.len(), 2);
        assert!(result.errors.is_empty());
        assert!(!a.exists());
        assert!(!b.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_local_wallpapers_with_partial_failure_keeps_others() {
        let dir = temp_cache_dir("local-delete-partial");
        let a = dir.join("a.png");
        let missing = dir.join("missing.png");
        write_png(&a, 4, 4);
        let paths = vec![a.display().to_string(), missing.display().to_string()];
        let result = delete_local_wallpapers_with(&paths, |p| fs::remove_file(p));
        assert_eq!(result.deleted, vec![a.display().to_string()]);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains("missing.png"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_local_wallpapers_with_all_fail_and_empty_list() {
        let dir = temp_cache_dir("local-delete-fail");
        let paths = vec![dir.join("x.png").display().to_string()];
        let result = delete_local_wallpapers_with(&paths, |p| fs::remove_file(p));
        assert!(result.deleted.is_empty());
        assert_eq!(result.errors.len(), 1);
        let empty = delete_local_wallpapers_with(&[], |p| fs::remove_file(p));
        assert!(empty.deleted.is_empty());
        assert!(empty.errors.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_thumbnail_data_url_reuses_cache_entry() {
        let _guard = THUMB_CACHE_TEST_LOCK.lock().unwrap();
        clear_thumb_cache();
        let dir = temp_cache_dir("local-cache");
        let img = dir.join("cached.png");
        write_png(&img, 8, 8);
        let size = fs::metadata(&img).unwrap().len();
        let modified = 1_700_000_000_000;
        let first = cached_thumbnail_data_url(&img, size, modified, 400).unwrap();
        let second = cached_thumbnail_data_url(&img, size, modified, 400).unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with("data:image/jpeg;base64,"));
        clear_thumb_cache();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_thumbnail_data_url_evicts_oldest_beyond_capacity() {
        let _guard = THUMB_CACHE_TEST_LOCK.lock().unwrap();
        clear_thumb_cache();
        let dir = temp_cache_dir("local-cache-cap");
        for i in 0..(crate::app_cache::APP_CACHE_MAX + 5) {
            let img = dir.join(format!("cap-{i}.png"));
            write_png(&img, 4, 4);
            let size = fs::metadata(&img).unwrap().len();
            let url = cached_thumbnail_data_url(&img, size, i as u64, 400).unwrap();
            assert!(!url.is_empty());
        }
        {
            let stats = crate::app_cache::stats();
            let thumb_entries = stats
                .namespaces
                .get(crate::app_cache::NS_THUMBS)
                .copied()
                .unwrap_or(0);
            assert!(thumb_entries <= crate::app_cache::APP_CACHE_MAX);
        }
        clear_thumb_cache();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_thumbnail_data_url_does_not_cache_failures() {
        let _guard = THUMB_CACHE_TEST_LOCK.lock().unwrap();
        clear_thumb_cache();
        let dir = temp_cache_dir("local-cache-fail");
        let missing = dir.join("nope.png");
        let url = cached_thumbnail_data_url(&missing, 0, 0, 400);
        assert!(url.is_none());
        {
            let stats = crate::app_cache::stats();
            let thumb_entries = stats
                .namespaces
                .get(crate::app_cache::NS_THUMBS)
                .copied()
                .unwrap_or(0);
            assert_eq!(thumb_entries, 0);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn thumb_cache_key_uses_path_size_and_mtime() {
        let key = thumb_cache_key(Path::new("/w/a.png"), 100, 200);
        assert_eq!(key, "/w/a.png:100:200");
        let other = thumb_cache_key(Path::new("/w/a.png"), 101, 200);
        assert_ne!(key, other);
    }
}
