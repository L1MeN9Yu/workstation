use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Iterm2RemoteKey {
    pub key: String,
    pub description: String,
    pub category: String,
    pub introduced: Option<String>,
}

/// 启发式分类，与 scripts/fetch-iterm2-keys.mjs 的 categorize 保持一致。
pub fn categorize(key: &str) -> String {
    const RENDERING: [&str; 11] = [
        "Font",
        "Spacing",
        "Anti Alias",
        "Anti-Alias",
        "Italic",
        "Bold",
        "Powerline",
        "Contrast",
        "Strokes",
        "Ligatures",
        "Width",
    ];
    if RENDERING.iter().any(|p| key.contains(p)) {
        return "字体与渲染".to_string();
    }
    const APPEARANCE: [&str; 7] = [
        "Color",
        "Background Image",
        "Transparency",
        "Blur",
        "Palette",
        "Theme",
        "Appearance",
    ];
    if APPEARANCE.iter().any(|p| key.contains(p)) {
        return "外观与主题".to_string();
    }
    if key.contains("Cursor") {
        return "光标".to_string();
    }
    const BEHAVIOR: [&str; 6] = ["Scroll", "Mouse", "Wheel", "Selection", "Bell", "Sound"];
    if BEHAVIOR.iter().any(|p| key.contains(p)) {
        return "行为与终端".to_string();
    }
    const BASIC: [&str; 9] = [
        "Command",
        "Shortcut",
        "Name",
        "Guid",
        "Profile",
        "Tags",
        "Rewritable",
        "Icon",
        "Title",
    ];
    if BASIC.iter().any(|p| key.contains(p)) {
        return "基本信息".to_string();
    }
    const KEYBOARD: [&str; 5] = ["Keyboard", "Trigger", "Map", "Key", "Hotkey"];
    if KEYBOARD.iter().any(|p| key.contains(p)) {
        return "键盘与按键".to_string();
    }
    const ENCODING: [&str; 4] = ["Encoding", "Character", "Locale", "Language"];
    if ENCODING.iter().any(|p| key.contains(p)) {
        return "字符与编码".to_string();
    }
    const SESSION: [&str; 7] = [
        "Session",
        "Job",
        "Process",
        "Terminal Columns",
        "Rows",
        "Idle",
        "Close",
    ];
    if SESSION.iter().any(|p| key.contains(p)) {
        return "会话与终端".to_string();
    }
    "其他".to_string()
}

const BLACKLIST: [&str; 5] = ["Profiles", "JSON", "XML", "Yes", "No"];

fn looks_like_key(candidate: &str) -> bool {
    let t = candidate.trim();
    t.len() >= 2
        && t.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && !BLACKLIST.contains(&t)
}

/// 解析官方 Dynamic Profiles 文档 HTML 中提及的 key：
/// - JSON 键形式 `"Key Name":`
/// - `<code>Key Name</code>` 内联代码（首字母大写）
pub fn parse_iterm2_keys_html(html: &str) -> Vec<Iterm2RemoteKey> {
    let mut keys: Vec<Iterm2RemoteKey> = Vec::new();

    // 1. "Key": 形式（JSON 键）
    let mut rest = html;
    while let Some(start) = rest.find('"') {
        let after_quote = &rest[start + 1..];
        let Some(end) = after_quote.find('"') else {
            break;
        };
        let candidate = &after_quote[..end];
        if looks_like_key(candidate) {
            let after_close = &after_quote[end + 1..];
            if after_close.trim_start().starts_with(':') {
                keys.push(Iterm2RemoteKey {
                    key: candidate.to_string(),
                    description: String::new(),
                    category: categorize(candidate),
                    introduced: None,
                });
            }
        }
        rest = &after_quote[end + 1..];
    }

    // 2. <code>...</code> 形式
    let mut rest = html;
    while let Some(start) = rest.find("<code>") {
        let after = &rest[start + "<code>".len()..];
        let Some(end) = after.find("</code>") else {
            break;
        };
        let candidate = &after[..end];
        if looks_like_key(candidate) {
            keys.push(Iterm2RemoteKey {
                key: candidate.to_string(),
                description: String::new(),
                category: categorize(candidate),
                introduced: None,
            });
        }
        rest = &after[end + "</code>".len()..];
    }

    merge_remote_keys(vec![keys])
}

/// 从 iTerm2 源码 `ProfileModel.m` 提取 `KEY_* = @"字段名"` 常量赋值（JSON 字段名全集）。
pub fn parse_profile_model_keys(src: &str) -> Vec<Iterm2RemoteKey> {
    let mut keys: Vec<Iterm2RemoteKey> = Vec::new();
    let mut rest = src;
    while let Some(pos) = rest.find("KEY_") {
        let after = &rest[pos + "KEY_".len()..];
        let ident_end = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        let tail = after[ident_end..].trim_start();
        let Some(after_eq) = tail.strip_prefix('=') else {
            // 推进，避免死循环
            rest = &after[ident_end..];
            continue;
        };
        let after_eq = after_eq.trim_start();
        let Some(after_at) = after_eq.strip_prefix('@') else {
            rest = after_eq;
            continue;
        };
        let after_at = after_at.trim_start();
        let Some(after_quote) = after_at.strip_prefix('"') else {
            rest = after_at;
            continue;
        };
        let Some(end) = after_quote.find('"') else {
            break;
        };
        let key = &after_quote[..end];
        if !key.is_empty() {
            keys.push(Iterm2RemoteKey {
                key: key.to_string(),
                description: String::new(),
                category: categorize(key),
                introduced: None,
            });
        }
        rest = &after_quote[end + 1..];
    }
    merge_remote_keys(vec![keys])
}

/// 多源合并：排序 + 去重（保留首个来源的同 key 记录）。
pub fn merge_remote_keys(sources: Vec<Vec<Iterm2RemoteKey>>) -> Vec<Iterm2RemoteKey> {
    let mut keys: Vec<Iterm2RemoteKey> = sources.into_iter().flatten().collect();
    keys.sort_by(|a, b| a.key.cmp(&b.key));
    keys.dedup_by(|a, b| a.key == b.key);
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_key_quotes_from_docs() {
        let html = r#"{ "Profiles": [ { "Name": "x", "Guid": "y", "Custom Command": "Yes" } ] }"#;
        let keys = parse_iterm2_keys_html(html);
        let names: Vec<&str> = keys.iter().map(|k| k.key.as_str()).collect();
        assert_eq!(names, vec!["Custom Command", "Guid", "Name"]);
        assert!(!names.contains(&"Profiles"));
        assert!(!names.contains(&"Yes"));
    }

    #[test]
    fn parses_code_blocks_from_docs() {
        let html = "<p>see <code>Guid</code> and <code>Rewritable</code> here</p>";
        let keys = parse_iterm2_keys_html(html);
        let names: Vec<&str> = keys.iter().map(|k| k.key.as_str()).collect();
        assert_eq!(names, vec!["Guid", "Rewritable"]);
    }

    #[test]
    fn ignores_non_key_code_and_values() {
        let html = "<p><code>~/Library/Application Support</code> <code>#rrggbb</code></p>";
        assert!(parse_iterm2_keys_html(html).is_empty());
    }

    #[test]
    fn ignores_lowercase_candidates() {
        let html = r#"<p>the "profiles" folder <code>reload</code></p>"#;
        assert!(parse_iterm2_keys_html(html).is_empty());
    }

    #[test]
    fn empty_html_returns_empty() {
        assert!(parse_iterm2_keys_html("").is_empty());
    }

    #[test]
    fn unclosed_quote_stops_parsing() {
        let html = r#"{ "Name: }"#;
        assert!(parse_iterm2_keys_html(html).is_empty());
    }

    #[test]
    fn unclosed_code_block_stops_parsing() {
        let html = "<p><code>no closing tag";
        assert!(parse_iterm2_keys_html(html).is_empty());
    }

    #[test]
    fn profile_model_unclosed_quote_keeps_collected() {
        let src = "KEY_NAME = @\"Name\";\nKEY_BROKEN = @\"no close";
        let keys = parse_profile_model_keys(src);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "Name");
    }

    #[test]
    fn profile_model_at_without_quote_skips_and_continues() {
        let src = "KEY_A = @something;\nKEY_B = @\"Real Key\";";
        let keys = parse_profile_model_keys(src);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "Real Key");
    }

    #[test]
    fn dedups_overlapping_quote_and_code() {
        let html = r#"<p>"Guid":</p><p><code>Guid</code></p>"#;
        let keys = parse_iterm2_keys_html(html);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "Guid");
    }

    #[test]
    fn parses_key_constants_from_profile_model() {
        let src = "NSString *const KEY_NAME = @\"Name\";\nNSString *const KEY_CURSOR_TYPE = @\"Cursor Type\";\nNSString *const KEY_NORMAL_FONT = @\"Normal Font\";\n";
        let keys = parse_profile_model_keys(src);
        let names: Vec<&str> = keys.iter().map(|k| k.key.as_str()).collect();
        assert_eq!(names, vec!["Cursor Type", "Name", "Normal Font"]);
        assert_eq!(
            keys.iter()
                .find(|k| k.key == "Cursor Type")
                .unwrap()
                .category,
            "光标"
        );
        assert_eq!(
            keys.iter()
                .find(|k| k.key == "Normal Font")
                .unwrap()
                .category,
            "字体与渲染"
        );
    }

    #[test]
    fn profile_model_handles_compact_assignment() {
        let src = "KEY_FOO=@\"Foo Bar\";KEY_BAR = @\"Bar\";";
        let keys = parse_profile_model_keys(src);
        let names: Vec<&str> = keys.iter().map(|k| k.key.as_str()).collect();
        assert_eq!(names, vec!["Bar", "Foo Bar"]);
    }

    #[test]
    fn profile_model_skips_non_assignments() {
        let src = "extern NSString *const KEY_NAME;\nKEY_OTHER = something_else;\n";
        assert!(parse_profile_model_keys(src).is_empty());
    }

    #[test]
    fn profile_model_empty_and_constant_only() {
        assert!(parse_profile_model_keys("").is_empty());
        assert!(parse_profile_model_keys("KEY_NAME;").is_empty());
    }

    #[test]
    fn profile_model_skips_empty_values() {
        let src = "KEY_EMPTY = @\"\";\nKEY_REAL = @\"Real Key\";\n";
        let keys = parse_profile_model_keys(src);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "Real Key");
    }

    #[test]
    fn merge_remote_keys_dedups_across_sources() {
        let doc = vec![Iterm2RemoteKey {
            key: "Name".into(),
            description: String::new(),
            category: "基本信息".into(),
            introduced: None,
        }];
        let src = vec![Iterm2RemoteKey {
            key: "Name".into(),
            description: String::new(),
            category: "基本信息".into(),
            introduced: None,
        }];
        let merged = merge_remote_keys(vec![doc, src]);
        assert_eq!(merged.len(), 1);
    }

    #[test]
    fn merge_remote_keys_keeps_first_source_record() {
        let first = vec![Iterm2RemoteKey {
            key: "Name".into(),
            description: "from doc".into(),
            category: "基本信息".into(),
            introduced: None,
        }];
        let second = vec![Iterm2RemoteKey {
            key: "Name".into(),
            description: "from src".into(),
            category: "其他".into(),
            introduced: None,
        }];
        let merged = merge_remote_keys(vec![first, second]);
        assert_eq!(merged[0].description, "from doc");
    }

    #[test]
    fn merge_remote_keys_empty_sources() {
        assert!(merge_remote_keys(vec![]).is_empty());
        assert!(merge_remote_keys(vec![vec![], vec![]]).is_empty());
    }

    #[test]
    fn categorizes_various_keys() {
        assert_eq!(categorize("Normal Font"), "字体与渲染");
        assert_eq!(categorize("Background Color"), "外观与主题");
        assert_eq!(categorize("Cursor Type"), "光标");
        assert_eq!(categorize("Silence Bell"), "行为与终端");
        assert_eq!(categorize("Custom Command"), "基本信息");
        assert_eq!(categorize("Keyboard Map"), "键盘与按键");
        assert_eq!(categorize("Character Encoding"), "字符与编码");
        assert_eq!(categorize("Close Sessions On End"), "会话与终端");
        assert_eq!(categorize("Mystery Setting"), "其他");
    }
}
