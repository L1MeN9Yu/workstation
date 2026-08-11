use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use futures_util::{StreamExt, TryStreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "workstation-wallpaper/0.1";
const DEFAULT_MIN_WIDTH: u32 = 1920;
const DEFAULT_MIN_HEIGHT: u32 = 1080;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WallpaperItem {
    pub id: String,
    pub source: String,
    pub thumb_url: String,
    pub full_url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SearchQuery {
    pub source: String,
    #[serde(default)]
    pub keywords: String,
    #[serde(default)]
    pub random: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SourceSettings {
    pub api_key: Option<String>,
    pub login: Option<String>,
    pub categories: Option<String>,
    pub purity: Option<String>,
    pub min_width: Option<u32>,
    pub min_height: Option<u32>,
    pub rating: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WallpaperSettings {
    pub proxy: Option<String>,
    pub download_dir: Option<String>,
    pub sources: HashMap<String, SourceSettings>,
}

impl WallpaperSettings {
    pub fn source(&self, id: &str) -> SourceSettings {
        self.sources.get(id).cloned().unwrap_or_default()
    }
}

fn build_client(proxy: Option<&str>) -> Result<Client, String> {
    let mut builder = Client::builder().user_agent(USER_AGENT);
    if let Some(p) = proxy.filter(|p| !p.trim().is_empty()) {
        builder =
            builder.proxy(reqwest::Proxy::all(p).map_err(|e| format!("invalid proxy url: {e}"))?);
    }
    builder
        .build()
        .map_err(|e| format!("failed to build http client: {e}"))
}

fn http_error(status: reqwest::StatusCode, source: &str) -> String {
    format!("{source} request failed with HTTP {}", status.as_u16())
}

fn is_known_source(source: &str) -> bool {
    matches!(source, "wallhaven" | "danbooru" | "safebooru")
}

pub async fn search_wallpapers(
    query: SearchQuery,
    settings: WallpaperSettings,
) -> Result<Vec<WallpaperItem>, String> {
    if !is_known_source(&query.source) {
        return Err(format!("unknown wallpaper source: {}", query.source));
    }
    let client = build_client(settings.proxy.as_deref())?;
    let src = settings.source(&query.source);
    match query.source.as_str() {
        "wallhaven" => search_wallhaven(&client, &query, &src).await,
        "danbooru" => search_danbooru(&client, &query, &src).await,
        "safebooru" => search_safebooru(&client, &query, &src).await,
        _ => unreachable!("guarded by is_known_source"),
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
) -> Result<Vec<WallpaperItem>, String> {
    let min_width = src.min_width.unwrap_or(DEFAULT_MIN_WIDTH);
    let min_height = src.min_height.unwrap_or(DEFAULT_MIN_HEIGHT);
    let mut url =
        reqwest::Url::parse("https://wallhaven.cc/api/v1/search").map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("categories", src.categories.as_deref().unwrap_or("010"));
        pairs.append_pair("purity", src.purity.as_deref().unwrap_or("100"));
        pairs.append_pair("atleast", &format!("{min_width}x{min_height}"));
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
        .map(|it| WallpaperItem {
            id: format!("wallhaven-{}", it.id),
            source: "wallhaven".to_string(),
            thumb_url: it.thumbs.small,
            full_url: it.path,
            width: it.dimension_x,
            height: it.dimension_y,
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
        reqwest::Url::parse("https://danbooru.donmai.us/posts.json").map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("tags", &tags.join(" "));
        pairs.append_pair("limit", "24");
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
) -> Result<Vec<WallpaperItem>, String> {
    let min_width = src.min_width.unwrap_or(DEFAULT_MIN_WIDTH);
    let mut url =
        reqwest::Url::parse("https://safebooru.org/index.php").map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("page", "dapi");
        pairs.append_pair("s", "post");
        pairs.append_pair("q", "index");
        pairs.append_pair("json", "1");
        pairs.append_pair("limit", "24");
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

    let mut file = fs::File::create(&path).map_err(|e| format!("cannot create file: {e}"))?;
    let mut stream = resp.bytes_stream().map_err(std::io::Error::other);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("cannot write file: {e}"))?;
    }
    file.flush()
        .map_err(|e| format!("cannot flush file: {e}"))?;
    Ok(path.display().to_string())
}

pub fn default_download_dir() -> PathBuf {
    dirs::home_dir()
        .map(|d| d.join(".config").join("cmux").join("wallpapers"))
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

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
            },
            settings,
        );
        let err = tauri::async_runtime::block_on(result).unwrap_err();
        assert!(err.contains("unknown wallpaper source"));
    }

    #[test]
    fn known_sources_are_allowed() {
        assert!(is_known_source("wallhaven"));
        assert!(is_known_source("danbooru"));
        assert!(is_known_source("safebooru"));
        assert!(!is_known_source("unsplash"));
        assert!(!is_known_source(""));
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
}
