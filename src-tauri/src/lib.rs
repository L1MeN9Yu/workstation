use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

pub mod runtime;

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .map(|d| d.join("workstation"))
        .expect("cannot resolve config directory")
}

fn config_path(key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.contains("..") || key.contains('/') || key.contains('\\') {
        return Err("invalid config key".to_string());
    }
    Ok(config_dir().join(format!("{key}.json")))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // serde_json cannot fail serializing a Value; unwrap is safe here.
    let raw = serde_json::to_string_pretty(value).unwrap();
    fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn read_config(key: String) -> Result<Value, String> {
    let path = config_path(&key)?;
    read_json_file(&path)
}

pub fn write_config(key: String, value: Value) -> Result<(), String> {
    let path = config_path(&key)?;
    write_json_file(&path, &value)
}

#[derive(Serialize)]
pub struct CmuxConfigFile {
    kind: &'static str,
    path: String,
    content: String,
}

pub fn cmux_config_path() -> Option<PathBuf> {
    // cmux writes its config to ~/.config/cmux/cmux.json (not the platform
    // config dir, which on macOS is ~/Library/Application Support).
    dirs::home_dir().map(|d| d.join(".config").join("cmux").join("cmux.json"))
}

pub fn ghosty_config_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(app_support) = dirs::data_dir() {
        candidates.push(app_support.join("com.cmuxterm.app").join("config.ghostty"));
    }
    if let Some(config) = dirs::config_dir() {
        candidates.push(config.join("ghostty").join("config"));
    }
    candidates
}

pub fn ghosty_config_path() -> Option<PathBuf> {
    ghosty_config_path_from(&ghosty_config_candidates())
}

pub fn ghosty_config_path_from(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.exists()).cloned()
}

fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn read_cmux_config_at(path: &Path) -> Result<CmuxConfigFile, String> {
    let content = read_text_file(path)?;
    Ok(CmuxConfigFile {
        kind: "cmux",
        path: path.display().to_string(),
        content,
    })
}

pub fn read_ghosty_config_at(path: &Path) -> Result<CmuxConfigFile, String> {
    let content = read_text_file(path)?;
    Ok(CmuxConfigFile {
        kind: "ghosty",
        path: path.display().to_string(),
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("workstation-test-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cmux_config_path_points_to_home_dot_config() {
        let path = cmux_config_path().expect("home dir should resolve");
        assert_eq!(path.file_name().unwrap(), "cmux.json");
        assert_eq!(path.parent().unwrap().file_name().unwrap(), "cmux");
        assert_eq!(
            path.parent()
                .unwrap()
                .parent()
                .unwrap()
                .file_name()
                .unwrap(),
            ".config"
        );
        let home = dirs::home_dir().unwrap();
        assert!(path.starts_with(home));
    }

    #[test]
    fn config_path_rejects_unsafe_keys() {
        assert!(config_path("").is_err());
        assert!(config_path("../etc/passwd").is_err());
        assert!(config_path("a/b").is_err());
        assert!(config_path("a\\b").is_err());
        assert!(config_path("theme").is_ok());
    }

    #[test]
    fn read_text_file_missing_returns_error() {
        let missing = std::env::temp_dir().join("workstation-missing-file-test");
        assert!(read_text_file(&missing).is_err());
    }

    #[test]
    fn read_text_file_present_returns_content() {
        let dir = temp_dir("read-text");
        let path = dir.join("config.ghostty");
        fs::write(&path, "background-opacity = 0.75\n").unwrap();
        assert_eq!(
            read_text_file(&path).unwrap(),
            "background-opacity = 0.75\n"
        );
    }

    #[test]
    fn ghosty_config_prefers_app_support() {
        // Resolution prefers the cmux app support candidate (first in list);
        // the pure function is covered independently of the local machine.
        let candidates = ghosty_config_candidates();
        assert!(!candidates.is_empty());
        let found = ghosty_config_path_from(&candidates);
        // If the real machine has a config, it must live under the home dir.
        if let Some(p) = found {
            let home = dirs::home_dir().unwrap();
            assert!(p.starts_with(home));
        }
    }

    #[test]
    fn ghosty_config_candidates_are_nonempty_and_prefer_app_support() {
        let candidates = ghosty_config_candidates();
        assert!(!candidates.is_empty());
        // App support candidate comes first.
        let first = candidates[0].display().to_string();
        assert!(first.contains("com.cmuxterm.app"));
    }

    #[test]
    fn ghosty_config_path_from_picks_first_existing() {
        let dir = temp_dir("ghosty-from");
        let first = dir.join("first.ghostty");
        let second = dir.join("second.ghostty");
        fs::write(&first, "a").unwrap();
        fs::write(&second, "b").unwrap();
        let found = ghosty_config_path_from(&[first.clone(), second.clone()]);
        assert_eq!(found, Some(first));
    }

    #[test]
    fn ghosty_config_path_from_picks_second_when_first_missing() {
        let dir = temp_dir("ghosty-from-2");
        let missing = dir.join("missing.ghostty");
        let second = dir.join("second.ghostty");
        fs::write(&second, "b").unwrap();
        let found = ghosty_config_path_from(&[missing.clone(), second.clone()]);
        assert_eq!(found, Some(second));
    }

    #[test]
    fn ghosty_config_path_from_returns_none_when_all_missing() {
        let dir = temp_dir("ghosty-from-none");
        let found = ghosty_config_path_from(&[dir.join("a.ghostty"), dir.join("b.ghostty")]);
        assert_eq!(found, None);
    }

    #[test]
    fn read_json_file_missing_returns_null() {
        let dir = temp_dir("json-missing");
        let result = read_json_file(&dir.join("nope.json")).unwrap();
        assert_eq!(result, Value::Null);
    }

    #[test]
    fn read_json_file_parses_valid_content() {
        let dir = temp_dir("json-valid");
        let path = dir.join("theme.json");
        fs::write(&path, r#"{"theme":"dark"}"#).unwrap();
        let result = read_json_file(&path).unwrap();
        assert_eq!(result["theme"], "dark");
    }

    #[test]
    fn read_json_file_errors_on_invalid_json() {
        let dir = temp_dir("json-invalid");
        let path = dir.join("bad.json");
        fs::write(&path, "not json at all").unwrap();
        assert!(read_json_file(&path).is_err());
    }

    #[test]
    fn read_json_file_errors_when_unreadable() {
        let dir = temp_dir("json-unreadable");
        let path = dir.join("locked.json");
        fs::write(&path, "{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
            assert!(read_json_file(&path).is_err());
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }
        #[cfg(not(unix))]
        {
            // On non-unix platforms reading a directory is an error.
            let dir_path = dir.join("sub");
            fs::create_dir_all(&dir_path).unwrap();
            assert!(read_json_file(&dir_path).is_err());
        }
    }

    #[test]
    fn write_json_file_errors_when_unwritable() {
        let dir = temp_dir("json-unwritable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // A read-only directory forces fs::write to fail when the file
            // does not exist yet (covers the final map_err branch).
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
            let path = dir.join("locked.json");
            assert!(write_json_file(&path, &serde_json::json!({"x": 1})).is_err());
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(not(unix))]
        {
            let dir_path = dir.join("sub");
            fs::create_dir_all(&dir_path).unwrap();
            assert!(write_json_file(&dir_path, &serde_json::json!({"x": 1})).is_err());
        }
    }

    #[test]
    fn write_json_file_errors_when_parent_is_a_file() {
        let dir = temp_dir("json-parent-file");
        let blocker = dir.join("blocker");
        fs::write(&blocker, "i am a file, not a dir").unwrap();
        let path = blocker.join("nested").join("data.json");
        assert!(write_json_file(&path, &serde_json::json!({"x": 1})).is_err());
    }

    #[test]
    fn read_text_file_errors_when_unreadable() {
        let dir = temp_dir("text-unreadable");
        let path = dir.join("locked.txt");
        fs::write(&path, "hello").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
            assert!(read_text_file(&path).is_err());
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }
        #[cfg(not(unix))]
        {
            let dir_path = dir.join("sub");
            fs::create_dir_all(&dir_path).unwrap();
            assert!(read_text_file(&dir_path).is_err());
        }
    }

    #[test]
    fn write_json_file_creates_parent_dirs_and_roundtrips() {
        let dir = temp_dir("write-roundtrip");
        let path = dir.join("nested").join("sub").join("data.json");
        let value = serde_json::json!({"a": 1, "b": [true, null]});
        write_json_file(&path, &value).unwrap();
        let read = read_json_file(&path).unwrap();
        assert_eq!(read, value);
    }

    #[test]
    fn config_commands_reject_invalid_keys() {
        assert!(read_config("../evil".to_string()).is_err());
        assert!(write_config("a/b".to_string(), serde_json::json!({})).is_err());
    }

    #[test]
    fn config_commands_roundtrip_via_platform_config_dir() {
        let key = "__workstation_roundtrip_test__";
        let value = serde_json::json!({"ok": true});
        write_config(key.to_string(), value.clone()).unwrap();
        let read = read_config(key.to_string()).unwrap();
        assert_eq!(read, value);
        // cleanup
        let path = config_path(key).unwrap();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_cmux_config_at_returns_kind_and_content() {
        let dir = temp_dir("cmux-at");
        let path = dir.join("cmux.json");
        fs::write(&path, r#"{"schemaVersion": 1}"#).unwrap();
        let file = read_cmux_config_at(&path).unwrap();
        assert_eq!(file.kind, "cmux");
        assert_eq!(file.path, path.display().to_string());
        assert!(file.content.contains("schemaVersion"));
    }

    #[test]
    fn read_cmux_config_at_errors_on_missing_file() {
        let dir = temp_dir("cmux-at-missing");
        assert!(read_cmux_config_at(&dir.join("cmux.json")).is_err());
    }

    #[test]
    fn read_ghosty_config_at_returns_kind_and_content() {
        let dir = temp_dir("ghosty-at");
        let path = dir.join("config.ghostty");
        fs::write(&path, "background-opacity = 0.75").unwrap();
        let file = read_ghosty_config_at(&path).unwrap();
        assert_eq!(file.kind, "ghosty");
        assert!(file.content.contains("background-opacity"));
    }

    #[test]
    fn read_ghosty_config_at_errors_on_missing_file() {
        let dir = temp_dir("ghosty-at-missing");
        assert!(read_ghosty_config_at(&dir.join("config.ghostty")).is_err());
    }
}
