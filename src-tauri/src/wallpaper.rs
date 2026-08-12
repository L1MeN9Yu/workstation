use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{StreamExt, TryStreamExt};
use reqwest::Client;
use serde::{Deserialize, Deserializer, Serialize};

const USER_AGENT: &str = "workstation-wallpaper/0.1";
const DEFAULT_MIN_WIDTH: u32 = 1920;
const DEFAULT_MIN_HEIGHT: u32 = 1080;
const CACHE_META_FILE: &str = "cache_meta.json";
const MAX_CACHE_BYTES: u64 = 20_000_000_000; // 20GB（十进制）

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
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WallpaperSettings {
    pub proxy: Option<String>,
    pub download_dir: Option<String>,
    pub sources: HashMap<String, SourceSettings>,
    #[serde(skip)]
    pub base_urls: HashMap<String, String>,
}

impl WallpaperSettings {
    pub fn source(&self, id: &str) -> SourceSettings {
        self.sources.get(id).cloned().unwrap_or_default()
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
    let min_width = src.min_width.unwrap_or(DEFAULT_MIN_WIDTH);
    let min_height = src.min_height.unwrap_or(DEFAULT_MIN_HEIGHT);
    let mut url =
        reqwest::Url::parse(&format!("{base_url}/api/v1/search")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("categories", src.categories.as_deref().unwrap_or("010"));
        pairs.append_pair("purity", src.purity.as_deref().unwrap_or("100"));
        pairs.append_pair("atleast", &format!("{min_width}x{min_height}"));
        if query.page > 1 {
            pairs.append_pair("page", &query.page.to_string());
        }
        if let Some(key) = src.api_key.as_deref().filter(|k| !k.is_empty()) {
            pairs.append_pair("apikey", key);
        }
        if query.random {
            pairs.append_pair("sorting", "random");
            pairs.append_pair("order", "desc");
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
        .filter(|it| it.dimension_x >= min_width && it.dimension_y >= min_height)
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
    let client = build_client(settings.proxy.as_deref())?;
    let dir = settings
        .download_dir
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create download dir: {e}"))?;

    let resp = client
        .get(&item.full_url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(http_error(resp.status(), "download"));
    }
    let ext = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(extension_from_content_type)
        .unwrap_or("jpg");
    let file_name = sanitize_file_name(&item.id);
    let path = dir.join(format!("{file_name}.{ext}"));

    let stream = resp.bytes_stream().map_err(std::io::Error::other);
    write_download_stream(&path, stream).await?;
    Ok(path.display().to_string())
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
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
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

fn prune_lru_locked(dir: &Path, index: &mut ThumbIndex, max_bytes: u64) {
    let total: u64 = index.values().map(|e| e.size).sum();
    if total <= max_bytes {
        return;
    }
    let mut ordered: Vec<(String, u64)> = index
        .iter()
        .map(|(h, e)| (h.clone(), e.last_access_ms))
        .collect();
    ordered.sort_by_key(|(_, ts)| *ts);
    for (hash, _) in ordered {
        let remaining: u64 = index.values().map(|e| e.size).sum();
        if remaining <= max_bytes {
            break;
        }
        if let Some(entry) = index.remove(&hash) {
            let _ = fs::remove_file(cache_file_path(dir, &hash, &entry.ext));
        }
    }
}

fn prune_lru(dir: &Path, index: &mut ThumbIndex) {
    prune_lru_locked(dir, index, MAX_CACHE_BYTES);
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
            prune_lru(&self.dir, &mut index);
        }
        save_thumb_index(&self.dir, &self.index.read().unwrap());
        let bytes = fs::read(&path).map_err(|e| format!("cache read failed: {e}"))?;
        Ok((bytes, mime_for_ext(ext)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;

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
    fn search_wallhaven_parses_and_filters() {
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
        };
        let items = tauri::async_runtime::block_on(search_wallhaven(
            &client,
            &query,
            &src,
            &server.base_url(),
        ))
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "wallhaven-a1");
        assert_eq!(items[0].source, "wallhaven");
        assert_eq!(items[0].thumb_url, "https://t/1.jpg");
        assert_eq!(items[0].width, 2560);
        assert_eq!(server.hit_count(), 1);
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
    fn prune_lru_evicts_oldest_beyond_capacity() {
        let dir = temp_cache_dir("lru");
        let mut index = ThumbIndex::new();
        for i in 0..3 {
            let hash = format!("h{i:016x}");
            std::fs::write(cache_file_path(&dir, &hash, "jpg"), vec![0u8; 100]).unwrap();
            index.insert(
                hash,
                ThumbMetaEntry {
                    url: format!("u{i}"),
                    size: 100,
                    ext: "jpg".to_string(),
                    last_access_ms: i as u64,
                },
            );
        }
        prune_lru_locked(&dir, &mut index, 250);
        assert!(!index.contains_key("h0000000000000000"), "oldest evicted");
        assert!(index.contains_key("h0000000000000001"));
        assert!(index.contains_key("h0000000000000002"));
        assert!(!cache_file_path(&dir, "h0000000000000000", "jpg").exists());
        assert!(index.values().map(|e| e.size).sum::<u64>() <= 250);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_lru_keeps_index_within_capacity_when_under_limit() {
        let dir = temp_cache_dir("lru-under");
        let mut index = ThumbIndex::new();
        index.insert(
            "h0000000000000000".to_string(),
            ThumbMetaEntry {
                url: "u".to_string(),
                size: 10,
                ext: "jpg".to_string(),
                last_access_ms: 1,
            },
        );
        prune_lru_locked(&dir, &mut index, 250);
        assert_eq!(index.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
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
            base_urls: HashMap::new(),
        };
        let path = tauri::async_runtime::block_on(download_wallpaper(item, settings)).unwrap();
        assert!(path.ends_with("danbooru-42.png"));
        assert_eq!(read_body(Path::new(&path)), "png-bytes");
        let _ = std::fs::remove_dir_all(&dir);
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
        assert!(err.contains("download"));
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
}
