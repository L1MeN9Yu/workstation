use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::ser::SerializeStruct;
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

fn write_text_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    ));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn write_cmux_config_at(path: &Path, content: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("cmux config file not found: {}", path.display()));
    }
    write_text_file_atomic(path, content)
}

pub fn write_ghosty_config_at(path: &Path, content: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("ghosty config file not found: {}", path.display()));
    }
    write_text_file_atomic(path, content)
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

#[derive(Clone, Debug, PartialEq)]
pub enum CmuxReloadStatus {
    Success,
    NotRunning,
    CliMissing,
    Failed(String),
}

impl Serialize for CmuxReloadStatus {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (status, message) = match self {
            CmuxReloadStatus::Success => ("success", None),
            CmuxReloadStatus::NotRunning => ("notRunning", None),
            CmuxReloadStatus::CliMissing => ("cliMissing", None),
            CmuxReloadStatus::Failed(e) => ("failed", Some(e)),
        };
        let mut s = serializer.serialize_struct("CmuxReloadStatus", 2)?;
        s.serialize_field("status", status)?;
        if let Some(m) = message {
            s.serialize_field("message", m)?;
        }
        s.end()
    }
}

enum CmuxRunError {
    NotFound,
    Other(String),
}

fn run_cmux(args: &[&str]) -> Result<String, CmuxRunError> {
    match Command::new("cmux").args(args).output() {
        Err(e) if e.kind() == ErrorKind::NotFound => Err(CmuxRunError::NotFound),
        Err(e) => Err(CmuxRunError::Other(e.to_string())),
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
        Ok(out) => Err(CmuxRunError::Other(format!(
            "cmux {} failed with {}: {}",
            args.join(" "),
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ))),
    }
}

fn classify_reload(
    result: Result<String, CmuxRunError>,
    ping: Option<Result<String, CmuxRunError>>,
) -> CmuxReloadStatus {
    match result {
        Ok(_) => CmuxReloadStatus::Success,
        Err(CmuxRunError::NotFound) => CmuxReloadStatus::CliMissing,
        Err(CmuxRunError::Other(e)) => match ping {
            Some(Ok(out)) if out.trim().contains("PONG") => CmuxReloadStatus::Failed(e),
            _ => CmuxReloadStatus::NotRunning,
        },
    }
}

pub fn reload_cmux_config_impl() -> Result<CmuxReloadStatus, String> {
    let reload = run_cmux(&["config", "reload"]);
    let ping = if matches!(reload, Err(CmuxRunError::Other(_))) {
        Some(run_cmux(&["ping"]))
    } else {
        None
    };
    Ok(classify_reload(reload, ping))
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
    fn ghosty_config_path_matches_candidates_resolution() {
        // ghosty_config_path is a thin wrapper over the pure resolver.
        let expected = ghosty_config_path_from(&ghosty_config_candidates());
        assert_eq!(ghosty_config_path(), expected);
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

    #[test]
    fn write_cmux_config_at_roundtrips_content() {
        let dir = temp_dir("cmux-write");
        let path = dir.join("cmux.json");
        fs::write(&path, "{\"schemaVersion\": 1}").unwrap();
        write_cmux_config_at(&path, "{\"schemaVersion\": 2}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"schemaVersion\": 2}");
    }

    #[test]
    fn write_cmux_config_at_errors_on_missing_file() {
        let dir = temp_dir("cmux-write-missing");
        let err = write_cmux_config_at(&dir.join("cmux.json"), "{}").unwrap_err();
        assert!(err.contains("cmux config file not found"));
    }

    #[test]
    fn write_ghosty_config_at_roundtrips_content() {
        let dir = temp_dir("ghosty-write");
        let path = dir.join("config.ghostty");
        fs::write(&path, "background-opacity = 0.75").unwrap();
        write_ghosty_config_at(&path, "background-opacity = 0.5").unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "background-opacity = 0.5"
        );
    }

    #[test]
    fn write_ghosty_config_at_errors_on_missing_file() {
        let dir = temp_dir("ghosty-write-missing");
        let err = write_ghosty_config_at(&dir.join("config.ghostty"), "key = v").unwrap_err();
        assert!(err.contains("ghosty config file not found"));
    }

    #[test]
    fn write_text_file_atomic_creates_parent_dirs() {
        let dir = temp_dir("atomic-parents");
        let path = dir.join("nested").join("deep").join("config");
        write_text_file_atomic(&path, "hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
        // no temp leftovers
        let leftover: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("tmp-"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind");
    }

    #[test]
    fn write_json_file_skips_create_dir_when_no_parent() {
        // "/" has no parent; write fails harmlessly on the root entry.
        let err = write_json_file(Path::new("/"), &serde_json::json!({"x": 1})).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn write_text_file_atomic_skips_create_dir_when_no_parent() {
        let err = write_text_file_atomic(Path::new("/"), "hi").unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn write_text_file_atomic_cleans_up_tmp_on_rename_failure() {
        let dir = temp_dir("atomic-rename-fail");
        let path = dir.join("target");
        fs::create_dir_all(&path).unwrap();
        let err = write_text_file_atomic(&path, "hi").unwrap_err();
        assert!(!err.is_empty());
        let leftover: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("tmp-"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind");
    }

    #[test]
    fn classify_reload_ok_is_success() {
        let status = classify_reload(Ok("reloaded".to_string()), None);
        assert_eq!(status, CmuxReloadStatus::Success);
    }

    #[test]
    fn classify_reload_not_found_is_cli_missing() {
        let status = classify_reload(Err(CmuxRunError::NotFound), None);
        assert_eq!(status, CmuxReloadStatus::CliMissing);
    }

    #[test]
    fn classify_reload_failed_when_ping_pongs() {
        let status = classify_reload(
            Err(CmuxRunError::Other("reload failed".to_string())),
            Some(Ok("PONG\n".to_string())),
        );
        assert_eq!(
            status,
            CmuxReloadStatus::Failed("reload failed".to_string())
        );
    }

    #[test]
    fn classify_reload_not_running_when_ping_not_pong() {
        let status = classify_reload(
            Err(CmuxRunError::Other("reload failed".to_string())),
            Some(Ok("nothing here".to_string())),
        );
        assert_eq!(status, CmuxReloadStatus::NotRunning);
    }

    #[test]
    fn classify_reload_not_running_when_ping_errors() {
        let status = classify_reload(
            Err(CmuxRunError::Other("reload failed".to_string())),
            Some(Err(CmuxRunError::Other("connect refused".to_string()))),
        );
        assert_eq!(status, CmuxReloadStatus::NotRunning);
    }

    #[test]
    fn classify_reload_not_running_when_ping_absent() {
        let status = classify_reload(Err(CmuxRunError::Other("reload failed".to_string())), None);
        assert_eq!(status, CmuxReloadStatus::NotRunning);
    }

    #[test]
    fn cmux_reload_status_serializes_as_flat_object() {
        let success = serde_json::to_value(CmuxReloadStatus::Success).unwrap();
        assert_eq!(success, serde_json::json!({"status": "success"}));
        let failed = serde_json::to_value(CmuxReloadStatus::Failed("boom".to_string())).unwrap();
        assert_eq!(
            failed,
            serde_json::json!({"status": "failed", "message": "boom"})
        );
    }
}
