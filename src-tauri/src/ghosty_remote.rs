use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GhostyRemoteKey {
    pub key: String,
    pub description: String,
    pub category: String,
    pub introduced: Option<String>,
}

/// 剔除 HTML 标签与实体；`<pre>` 块整体删除（含内容）。
fn strip_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    let mut in_pre = false;
    while let Some(ch) = chars.next() {
        if in_pre {
            // 已进入 pre 块：跳过直到 </pre>
            if ch == '<' {
                let mut tail = String::new();
                tail.push(ch);
                while let Some(&next) = chars.peek() {
                    tail.push(next);
                    chars.next();
                    if next == '>' {
                        break;
                    }
                }
                if tail.to_ascii_lowercase().starts_with("</pre") {
                    in_pre = false;
                }
            }
            continue;
        }
        match ch {
            '<' => {
                let mut tag = String::new();
                tag.push(ch);
                while let Some(&next) = chars.peek() {
                    tag.push(next);
                    chars.next();
                    if next == '>' {
                        break;
                    }
                }
                if tag.to_ascii_lowercase().starts_with("<pre") {
                    in_pre = true;
                }
            }
            _ => out.push(ch),
        }
    }
    out.replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn categorize(key: &str) -> String {
    if key.starts_with("font-")
        || key.starts_with("adjust-")
        || key.starts_with("grapheme-")
        || key.starts_with("freetype-")
        || key == "alpha-blending"
    {
        return "字体与渲染".to_string();
    }
    if key.starts_with("theme")
        || key.starts_with("background")
        || key.starts_with("foreground")
        || key.starts_with("palette")
        || key.starts_with("selection")
        || key.starts_with("search")
        || key.starts_with("minimum-contrast")
        || key.starts_with("cursor-color")
        || key.starts_with("cursor-text")
        || key.starts_with("bold-color")
        || key.starts_with("faint-opacity")
        || key.starts_with("split")
        || key.starts_with("unfocused")
    {
        return "外观与主题".to_string();
    }
    if key.starts_with("cursor-") {
        return "光标".to_string();
    }
    if key.starts_with("mouse-") || key.starts_with("scroll-") {
        return "鼠标与滚动".to_string();
    }
    if key.starts_with("window-") {
        return "窗口".to_string();
    }
    if key.starts_with("macos-") {
        return "macOS".to_string();
    }
    if key.starts_with("linux-") || key.starts_with("gtk-") {
        return "Linux/GTK".to_string();
    }
    if key.starts_with("auto-update") {
        return "更新".to_string();
    }
    if key.starts_with("notify-") {
        return "通知".to_string();
    }
    if key.starts_with("command")
        || key.starts_with("initial-command")
        || key.starts_with("shell-integration")
        || key.starts_with("term")
        || key.starts_with("keybind")
        || key.starts_with("clipboard")
    {
        return "行为与终端".to_string();
    }
    "其他".to_string()
}

fn extract_introduced(description: &str) -> Option<String> {
    let lower = description.to_lowercase();
    for keyword in ["since", "in"] {
        let pat = format!("available {keyword}:");
        if let Some(pos) = lower.find(&pat) {
            let rest = &description[pos + pat.len()..];
            let first = rest.find(|c: char| c.is_ascii_digit())?;
            let version = &rest[first..];
            let end = version
                .find(|c: char| !(c.is_ascii_digit() || c == '.'))
                .unwrap_or(version.len());
            return Some(version[..end].to_string());
        }
    }
    None
}

/// 解析 ghosty 官方配置参考 HTML，提取全部 `key` 标题与说明段落。
pub fn parse_ghosty_keys_html(html: &str) -> Vec<GhostyRemoteKey> {
    const MAX_DESC: usize = 300;

    // 第一遍：提取 (key, body) 列表
    let mut entries: Vec<(&str, String)> = Vec::new();
    let mut search_from = 0;
    while let Some(h2_rel) = html[search_from..].find("<h2") {
        let h2_start = search_from + h2_rel;
        // h2 开标签必须以 > 结束，且其后紧跟 <code>（跳过空白），
        // 否则视为普通标题（如 "Chained Actions"）而不是配置项。
        let Some(tag_end_rel) = html[h2_start..].find('>') else {
            break;
        };
        let after_tag = h2_start + tag_end_rel + 1;
        let Some(trimmed) = html[after_tag..].find(|c: char| !c.is_whitespace()) else {
            break;
        };
        let code_start_candidate = after_tag + trimmed;
        if !html[code_start_candidate..].starts_with("<code>") {
            search_from = code_start_candidate + 1;
            continue;
        }
        let code_start = code_start_candidate + "<code>".len();
        let Some(code_end) = html[code_start..].find("</code>") else {
            break;
        };
        let key = &html[code_start..code_start + code_end];
        let body_start = code_start + code_end + "</code>".len();
        let body_end = html[body_start..]
            .find("<h2")
            .map(|pos| body_start + pos)
            .unwrap_or(html.len());
        entries.push((key, strip_tags(&html[body_start..body_end])));
        search_from = body_end;
    }

    // 第二遍：空 body 继承其后第一个非空 body（连续 h2 共享段落）
    let mut keys: Vec<GhostyRemoteKey> = Vec::with_capacity(entries.len());
    for (i, (key, body)) in entries.iter().enumerate() {
        let mut description = body.clone();
        if description.is_empty() {
            for (_, later) in entries.iter().skip(i + 1) {
                if !later.is_empty() {
                    description = later.clone();
                    break;
                }
            }
        }
        if description.len() > MAX_DESC {
            description = format!("{}...", &description[..MAX_DESC - 3]);
        }
        keys.push(GhostyRemoteKey {
            key: key.to_string(),
            description: description.clone(),
            category: categorize(key),
            introduced: extract_introduced(&description),
        });
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_key_with_description() {
        let html = "<h2 class=\"x\"><code>font-size</code></h2><p>Font size in points.</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "font-size");
        assert_eq!(keys[0].description, "Font size in points.");
        assert_eq!(keys[0].category, "字体与渲染");
        assert!(keys[0].introduced.is_none());
    }

    #[test]
    fn strips_tags_entities_and_pre_blocks() {
        let html = "<h2><code>theme</code></h2><p>A &lt;b&gt;theme&lt;/b&gt; with &#x27;quote&#x27; &amp; more.</p><pre><code>theme = x</code></pre>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys[0].description, "A <b>theme</b> with 'quote' & more.");
        assert_eq!(keys[0].category, "外观与主题");
    }

    #[test]
    fn extracts_introduced_since_version() {
        let html =
            "<h2><code>mouse-scroll-multiplier</code></h2><p>Multiplier. Available since: 1.2.1</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys[0].introduced.as_deref(), Some("1.2.1"));
    }

    #[test]
    fn extracts_introduced_in_version() {
        let html = "<h2><code>adjust-icon-height</code></h2><p>Height. Available in: 1.2.0</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys[0].introduced.as_deref(), Some("1.2.0"));
    }

    #[test]
    fn no_introduced_when_absent() {
        let html = "<h2><code>font-size</code></h2><p>Plain.</p>";
        let keys = parse_ghosty_keys_html(html);
        assert!(keys[0].introduced.is_none());
    }

    #[test]
    fn consecutive_headers_share_next_body() {
        let html = "<h2><code>font-family</code></h2><h2><code>font-family-bold</code></h2><p>The font families to use.</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].key, "font-family");
        assert_eq!(keys[0].description, "The font families to use.");
        assert_eq!(keys[1].key, "font-family-bold");
        assert_eq!(keys[1].description, "The font families to use.");
    }

    #[test]
    fn truncates_long_descriptions() {
        let long = "x".repeat(1000);
        let html = format!("<h2><code>key</code></h2><p>{long}</p>");
        let keys = parse_ghosty_keys_html(&html);
        assert_eq!(keys[0].description.len(), 300);
        assert!(keys[0].description.ends_with("..."));
    }

    #[test]
    fn empty_document_returns_empty() {
        assert!(parse_ghosty_keys_html("").is_empty());
    }

    #[test]
    fn no_h2_matches_returns_empty() {
        assert!(parse_ghosty_keys_html("<p>no headers here</p>").is_empty());
    }

    #[test]
    fn plain_heading_with_inline_code_is_not_a_key() {
        // 官方文档在 keybind 后有普通 h2 标题（如 "Key Tables"），正文含 <code> 行内代码，
        // 不应被误解析为配置项 key。
        let html = "<h2><code>keybind</code></h2><p>bindings.</p><h2>Key Tables</h2><p>syntax <code>&lt;table&gt;/&lt;binding&gt;</code>.</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "keybind");
    }

    #[test]
    fn h2_with_attributes_followed_by_code_is_parsed() {
        let html = "<h2 class=\"x\">  <code>font-size</code></h2><p>desc</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "font-size");
    }

    #[test]
    fn categorizes_platform_and_misc_keys() {
        let html = "<h2><code>macos-icon</code></h2><p>a</p><h2><code>gtk-titlebar</code></h2><p>b</p><h2><code>language</code></h2><p>c</p><h2><code>cursor-style</code></h2><p>d</p><h2><code>window-padding-x</code></h2><p>e</p><h2><code>auto-update</code></h2><p>f</p><h2><code>notify-on-command-finish</code></h2><p>g</p><h2><code>keybind</code></h2><p>h</p><h2><code>mouse-reporting</code></h2><p>i</p>";
        let keys = parse_ghosty_keys_html(html);
        let cat = |k: &str| keys.iter().find(|x| x.key == k).unwrap().category.as_str();
        assert_eq!(cat("macos-icon"), "macOS");
        assert_eq!(cat("gtk-titlebar"), "Linux/GTK");
        assert_eq!(cat("language"), "其他");
        assert_eq!(cat("cursor-style"), "光标");
        assert_eq!(cat("window-padding-x"), "窗口");
        assert_eq!(cat("auto-update"), "更新");
        assert_eq!(cat("notify-on-command-finish"), "通知");
        assert_eq!(cat("keybind"), "行为与终端");
        assert_eq!(cat("mouse-reporting"), "鼠标与滚动");
    }

    #[test]
    fn introduced_without_version_after_keyword_returns_none() {
        let html = "<h2><code>x</code></h2><p>Note. Available since: nothing here.</p>";
        let keys = parse_ghosty_keys_html(html);
        assert!(keys[0].introduced.is_none());
    }

    #[test]
    fn h2_without_code_breaks_parsing() {
        let html = "<h2>no code here</h2><p>rest</p>";
        assert!(parse_ghosty_keys_html(html).is_empty());
    }

    #[test]
    fn unclosed_code_breaks_parsing() {
        let html = "<h2><code>key-without-close";
        assert!(parse_ghosty_keys_html(html).is_empty());
    }

    #[test]
    fn h2_without_closing_tag_breaks_parsing() {
        let html = "<h2 no closing";
        assert!(parse_ghosty_keys_html(html).is_empty());
    }

    #[test]
    fn h2_with_only_whitespace_after_breaks_parsing() {
        let html = "<h2>   ";
        assert!(parse_ghosty_keys_html(html).is_empty());
    }

    #[test]
    fn empty_bodies_stay_empty_when_no_later_body() {
        let html = "<h2><code>a</code></h2><h2><code>b</code></h2>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys.len(), 2);
        assert!(keys[0].description.is_empty());
        assert!(keys[1].description.is_empty());
    }

    #[test]
    fn alpha_blending_categorized_as_rendering() {
        let html = "<h2><code>alpha-blending</code></h2><p>Color space.</p>";
        let keys = parse_ghosty_keys_html(html);
        assert_eq!(keys[0].category, "字体与渲染");
    }
}
