use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod app_cache;
pub mod db;
pub mod fonts;
pub mod ghosty_remote;
pub mod iterm2;
pub mod iterm2_remote;
pub mod logging;
pub mod runtime;
pub mod wallpaper;

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

#[derive(Debug, PartialEq)]
enum CmuxRunError {
    NotFound,
    Other(String),
}

/// cmux 命令路径配置（config key: `cmux`，字段序列化为 camelCase）。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CmuxSetting {
    #[serde(default)]
    pub bin_path: String,
}

/// 解析 cmux 路径配置值：Null 或缺失视为未配置，返回 None。
pub fn parse_cmux_setting(value: Value) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let s: CmuxSetting = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(Some(s.bin_path))
}

pub fn read_cmux_setting_impl() -> Result<Option<String>, String> {
    read_cmux_setting_from(|| read_config("cmux".to_string()))
}

fn read_cmux_setting_from(
    reader: impl FnOnce() -> Result<Value, String>,
) -> Result<Option<String>, String> {
    let value = reader()?;
    parse_cmux_setting(value)
}

pub fn write_cmux_setting_at(key: &str, bin_path: &str) -> Result<(), String> {
    write_config(key.to_string(), serde_json::json!({ "binPath": bin_path }))
}

pub fn write_cmux_setting_impl(bin_path: &str) -> Result<(), String> {
    write_cmux_setting_at("cmux", bin_path)
}

/// macOS 常见 cmux 安装位置（GUI 应用 PATH 不含用户 shell 目录时兜底探测）。
pub const CMUX_CANDIDATES: [&str; 3] = [
    "/opt/homebrew/bin/cmux",
    "/usr/local/bin/cmux",
    "/Applications/cmux.app/Contents/Resources/bin/cmux",
];

/// 按「配置路径 → PATH → 常见安装位置」解析 cmux 可执行文件路径。
pub fn cmux_bin_with(configured: Option<String>) -> Option<PathBuf> {
    if let Some(p) = configured.filter(|p| !p.trim().is_empty()) {
        return Some(PathBuf::from(p.trim()));
    }
    cmux_bin_from_path(std::env::var_os("PATH"))
}

pub fn cmux_bin_from_path(path_env: Option<std::ffi::OsString>) -> Option<PathBuf> {
    cmux_bin_from_parts(path_env, &CMUX_CANDIDATES)
}

fn cmux_bin_from_parts(
    path_env: Option<std::ffi::OsString>,
    candidates: &[&str],
) -> Option<PathBuf> {
    cmux_in_path_from(path_env).or_else(|| cmux_candidate_from(candidates))
}

/// 在 PATH 枚举目录中查找名为 `cmux` 的文件。
fn cmux_in_path_from(path_env: Option<std::ffi::OsString>) -> Option<PathBuf> {
    let path_env = path_env?;
    std::env::split_paths(&path_env)
        .map(|dir| dir.join("cmux"))
        .find(|p| p.is_file())
}

/// 在候选安装位置中取第一个存在的 cmux。
fn cmux_candidate_from(candidates: &[&str]) -> Option<PathBuf> {
    candidates.iter().map(PathBuf::from).find(|p| p.is_file())
}

/// cmux 可执行文件解析结果（camelCase 序列化供前端展示）。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectCmuxResult {
    pub configured_path: Option<String>,
    pub resolved_path: Option<String>,
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// 检测 cmux 路径：解析实际路径并执行 `cmux --version` 验证可用性。
pub fn detect_cmux_impl() -> Result<DetectCmuxResult, String> {
    detect_cmux_from(read_cmux_setting_impl, run_cmux_version)
}

fn detect_cmux_from(
    reader: impl Fn() -> Result<Option<String>, String>,
    run_version: impl Fn(&Path) -> Result<String, String>,
) -> Result<DetectCmuxResult, String> {
    let configured = reader()?;
    Ok(detect_cmux_with(configured, cmux_bin_with, run_version))
}

fn detect_cmux_with(
    configured: Option<String>,
    resolve: impl Fn(Option<String>) -> Option<PathBuf>,
    run_version: impl Fn(&Path) -> Result<String, String>,
) -> DetectCmuxResult {
    let Some(bin) = resolve(configured.clone()) else {
        return DetectCmuxResult {
            configured_path: configured,
            resolved_path: None,
            available: false,
            version: None,
            error: Some("未找到 cmux 命令，请检查安装与 PATH 或在设置页配置路径".to_string()),
        };
    };
    let resolved = bin.display().to_string();
    match run_version(&bin) {
        Ok(version) => DetectCmuxResult {
            configured_path: configured,
            resolved_path: Some(resolved),
            available: true,
            version: Some(version),
            error: None,
        },
        Err(e) => DetectCmuxResult {
            configured_path: configured,
            resolved_path: Some(resolved),
            available: false,
            version: None,
            error: Some(e),
        },
    }
}

fn run_cmux_version(bin: &Path) -> Result<String, String> {
    match run_command(bin, &["--version"]) {
        Ok(out) => Ok(out.lines().next().unwrap_or_default().trim().to_string()),
        Err(CmuxRunError::NotFound) => Err("路径不存在或不可执行".to_string()),
        Err(CmuxRunError::Other(e)) => Err(e),
    }
}

fn run_cmux(args: &[&str]) -> Result<String, CmuxRunError> {
    run_cmux_bin(args, cmux_bin_with(read_cmux_setting_impl().ok().flatten()))
}

fn run_cmux_bin(args: &[&str], bin: Option<PathBuf>) -> Result<String, CmuxRunError> {
    match bin {
        Some(bin) => run_command(&bin, args),
        None => Err(CmuxRunError::NotFound),
    }
}

fn run_command(
    program: impl AsRef<std::ffi::OsStr>,
    args: &[&str],
) -> Result<String, CmuxRunError> {
    let program = program.as_ref();
    let display = program.to_string_lossy();
    match Command::new(program).args(args).output() {
        Err(e) if e.kind() == ErrorKind::NotFound => Err(CmuxRunError::NotFound),
        Err(e) => Err(CmuxRunError::Other(e.to_string())),
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
        Ok(out) => Err(CmuxRunError::Other(format!(
            "{} {} failed with {}: {}",
            display,
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
    reload_cmux_config_with(run_cmux)
}

fn reload_cmux_config_with(
    mut run: impl FnMut(&[&str]) -> Result<String, CmuxRunError>,
) -> Result<CmuxReloadStatus, String> {
    let reload = run(&["config", "reload"]);
    let ping = if matches!(reload, Err(CmuxRunError::Other(_))) {
        Some(run(&["ping"]))
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

    fn fake_version(_bin: &Path) -> Result<String, String> {
        Ok("cmux 1.0.0".to_string())
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
        let not_running = serde_json::to_value(CmuxReloadStatus::NotRunning).unwrap();
        assert_eq!(not_running, serde_json::json!({"status": "notRunning"}));
        let cli_missing = serde_json::to_value(CmuxReloadStatus::CliMissing).unwrap();
        assert_eq!(cli_missing, serde_json::json!({"status": "cliMissing"}));
        let failed = serde_json::to_value(CmuxReloadStatus::Failed("boom".to_string())).unwrap();
        assert_eq!(
            failed,
            serde_json::json!({"status": "failed", "message": "boom"})
        );
    }

    #[test]
    fn run_command_ok_returns_stdout() {
        let out = run_command("cargo", &["--version"]).unwrap();
        assert!(out.trim_start().starts_with("cargo "));
    }

    #[test]
    fn run_command_nonzero_exit_is_other_error() {
        let err = run_command("cargo", &["__definitely_not_a_cargo_subcommand__"]).unwrap_err();
        assert!(matches!(err, CmuxRunError::Other(_)));
    }

    #[test]
    fn run_command_missing_program_is_not_found() {
        let err = run_command("workstation-no-such-binary-xyz", &[]).unwrap_err();
        assert!(matches!(err, CmuxRunError::NotFound));
    }

    #[test]
    fn run_command_spawn_failure_is_other_error() {
        let dir = temp_dir("run-command-spawn");
        let err = run_command(dir.display().to_string(), &[]).unwrap_err();
        assert!(matches!(err, CmuxRunError::Other(_)));
    }

    #[test]
    fn reload_cmux_config_with_probes_ping_on_failure() {
        let mut calls: Vec<String> = Vec::new();
        let status = reload_cmux_config_with(|args| {
            calls.push(args.join(" "));
            if calls.last().unwrap() == "config reload" {
                Err(CmuxRunError::Other("boom".to_string()))
            } else {
                Ok("PONG\n".to_string())
            }
        })
        .unwrap();
        assert_eq!(status, CmuxReloadStatus::Failed("boom".to_string()));
        assert_eq!(calls, vec!["config reload".to_string(), "ping".to_string()]);
    }

    #[test]
    fn reload_cmux_config_impl_returns_valid_status() {
        // Environment-independent: succeeds when cmux is installed and running,
        // otherwise reports cliMissing/notRunning; the result must still be one
        // of the four defined statuses.
        let status = reload_cmux_config_impl().unwrap();
        assert!(matches!(
            status,
            CmuxReloadStatus::Success
                | CmuxReloadStatus::NotRunning
                | CmuxReloadStatus::CliMissing
                | CmuxReloadStatus::Failed(_)
        ));
    }

    #[test]
    fn parse_cmux_setting_null_means_unconfigured() {
        assert_eq!(parse_cmux_setting(Value::Null).unwrap(), None);
    }

    #[test]
    fn parse_cmux_setting_reads_bin_path() {
        let value = serde_json::json!({ "binPath": "/custom/cmux" });
        assert_eq!(
            parse_cmux_setting(value).unwrap(),
            Some("/custom/cmux".to_string())
        );
    }

    #[test]
    fn parse_cmux_setting_missing_bin_path_yields_empty() {
        assert_eq!(
            parse_cmux_setting(serde_json::json!({})).unwrap(),
            Some(String::new())
        );
    }

    #[test]
    fn parse_cmux_setting_rejects_invalid_shape() {
        let err = parse_cmux_setting(serde_json::json!({ "binPath": 42 })).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn write_cmux_setting_at_roundtrips() {
        let key = "__workstation_cmux_setting_test__";
        write_cmux_setting_at(key, "/tmp/cmux-bin").unwrap();
        let read = read_config(key.to_string()).unwrap();
        assert_eq!(read, serde_json::json!({ "binPath": "/tmp/cmux-bin" }));
        let path = config_path(key).unwrap();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn write_cmux_setting_impl_roundtrips_then_restores() {
        let key_path = config_path("cmux").unwrap();
        let original = fs::read_to_string(&key_path).ok();
        write_cmux_setting_impl("/tmp/test-cmux-bin").unwrap();
        let read = read_config("cmux".to_string()).unwrap();
        assert_eq!(read, serde_json::json!({ "binPath": "/tmp/test-cmux-bin" }));
        restore_setting_file(&key_path, original);
    }

    #[test]
    fn restore_setting_file_restores_existing_content() {
        let dir = temp_dir("restore-setting");
        let path = dir.join("cmux.json");
        fs::write(&path, "original").unwrap();
        restore_setting_file(&path, Some("original".to_string()));
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    }

    #[test]
    fn restore_setting_file_removes_when_none() {
        let dir = temp_dir("restore-setting-none");
        let path = dir.join("cmux.json");
        fs::write(&path, "original").unwrap();
        restore_setting_file(&path, None);
        assert!(!path.exists());
    }

    fn restore_setting_file(key_path: &Path, original: Option<String>) {
        match original {
            Some(content) => fs::write(key_path, content).unwrap(),
            None => {
                let _ = fs::remove_file(key_path);
            }
        }
    }

    #[test]
    fn cmux_bin_with_uses_configured_path() {
        let found = cmux_bin_with(Some("  /custom/cmux  ".to_string()));
        assert_eq!(found, Some(PathBuf::from("/custom/cmux")));
    }

    #[test]
    fn cmux_bin_with_falls_through_on_blank_config() {
        let found = cmux_bin_with(Some("   ".to_string()));
        assert!(found.is_some() == cmux_bin_with(None).is_some());
    }

    #[test]
    fn cmux_bin_from_parts_falls_back_to_candidates() {
        let dir = temp_dir("cmux-parts");
        let existing = dir.join("cmux");
        fs::write(&existing, "").unwrap();
        let candidates = [existing.display().to_string()];
        let refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
        let path = dir.join("bin").display().to_string();
        let found = cmux_bin_from_parts(Some(std::ffi::OsString::from(path)), &refs);
        assert_eq!(found, Some(existing));
    }

    #[test]
    fn cmux_bin_from_parts_prefers_path_entry() {
        let dir = temp_dir("cmux-parts-path");
        let bin_dir = dir.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let path_bin = bin_dir.join("cmux");
        fs::write(&path_bin, "").unwrap();
        let candidates = [dir.join("nope").display().to_string()];
        let refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
        let found = cmux_bin_from_parts(
            Some(std::ffi::OsString::from(bin_dir.display().to_string())),
            &refs,
        );
        assert_eq!(found, Some(path_bin));
    }

    #[test]
    fn read_cmux_setting_from_propagates_reader_error() {
        let err = read_cmux_setting_from(|| Err("read failed".to_string())).unwrap_err();
        assert_eq!(err, "read failed");
    }

    #[test]
    fn read_cmux_setting_from_parses_null_as_unconfigured() {
        let result = read_cmux_setting_from(|| Ok(Value::Null)).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn cmux_in_path_from_finds_first_match() {
        let dir = temp_dir("cmux-path");
        let first = dir.join("cmux");
        fs::write(&first, "").unwrap();
        let other = dir.join("other");
        fs::create_dir_all(&other).unwrap();
        let path = std::env::join_paths([&other, &dir]).unwrap();
        assert_eq!(cmux_in_path_from(Some(path)), Some(first));
    }

    #[test]
    fn cmux_in_path_from_returns_none_when_missing_or_absent() {
        assert_eq!(cmux_in_path_from(None), None);
        let dir = temp_dir("cmux-path-missing");
        let path = std::env::join_paths([dir.join("bin")]).unwrap();
        assert_eq!(cmux_in_path_from(Some(path)), None);
    }

    #[test]
    fn cmux_candidate_from_picks_first_existing() {
        let dir = temp_dir("cmux-candidate");
        let existing = dir.join("cmux");
        fs::write(&existing, "").unwrap();
        let candidates = [
            dir.join("missing").display().to_string(),
            existing.display().to_string(),
        ];
        let refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
        assert_eq!(cmux_candidate_from(&refs), Some(existing));
    }

    #[test]
    fn cmux_candidate_from_returns_none_when_all_missing() {
        let dir = temp_dir("cmux-candidate-missing");
        let candidates = [
            dir.join("a").display().to_string(),
            dir.join("b").display().to_string(),
        ];
        let refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
        assert_eq!(cmux_candidate_from(&refs), None);
    }

    #[test]
    fn detect_cmux_with_reports_unavailable_when_not_resolved() {
        let result = detect_cmux_with(Some("/custom/cmux".to_string()), |_| None, fake_version);
        assert_eq!(result.configured_path, Some("/custom/cmux".to_string()));
        assert_eq!(result.resolved_path, None);
        assert!(!result.available);
        assert!(result.error.is_some());
    }

    #[test]
    fn detect_cmux_with_reports_available_with_version() {
        let result = detect_cmux_with(None, |_| Some(PathBuf::from("/custom/cmux")), fake_version);
        assert!(result.available);
        assert_eq!(result.version, Some("cmux 1.0.0".to_string()));
        assert_eq!(result.error, None);
        assert_eq!(result.resolved_path, Some("/custom/cmux".to_string()));
    }

    #[test]
    fn detect_cmux_with_reports_error_from_version_probe() {
        let result = detect_cmux_with(
            None,
            |_| Some(PathBuf::from("/custom/cmux")),
            |_| Err("boom".to_string()),
        );
        assert!(!result.available);
        assert_eq!(result.error, Some("boom".to_string()));
        assert_eq!(result.version, None);
    }

    #[test]
    fn detect_cmux_from_propagates_reader_error() {
        let err = detect_cmux_from(|| Err("config broken".to_string()), fake_version).unwrap_err();
        assert_eq!(err, "config broken");
    }

    #[test]
    fn detect_cmux_from_resolves_configured_path() {
        let result =
            detect_cmux_from(|| Ok(Some("/custom/cmux".to_string())), fake_version).unwrap();
        assert!(result.available);
        assert_eq!(result.resolved_path, Some("/custom/cmux".to_string()));
        assert_eq!(result.version, Some("cmux 1.0.0".to_string()));
    }

    #[test]
    fn detect_cmux_impl_runs_without_panic() {
        // 环境无关：真实配置缺失/损坏时都能产出结果或错误，不 panic。
        let _ = detect_cmux_impl();
    }

    #[test]
    #[cfg(unix)]
    fn run_cmux_bin_uses_resolved_binary() {
        let dir = temp_dir("run-cmux-bin");
        let bin = dir.join("cmux");
        fs::write(&bin, "#!/bin/sh\necho ok\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let out = run_cmux_bin(&["ping"], Some(bin.clone())).unwrap();
        assert_eq!(out.trim(), "ok");
    }

    #[test]
    fn run_cmux_bin_reports_not_found_without_binary() {
        let err = run_cmux_bin(&["ping"], None).unwrap_err();
        assert_eq!(err, CmuxRunError::NotFound);
    }

    #[test]
    #[cfg(unix)]
    fn run_cmux_version_ok_returns_first_line() {
        // 脚本无任何 stdout：覆盖 lines() 返回 None（空输出）的分支。
        let dir = temp_dir("cmux-version-empty");
        let script = dir.join("silent-cmux");
        fs::write(&script, "#!/bin/sh\nexit 0\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let out = run_cmux_version(&script).unwrap();
        assert_eq!(out, "");
    }

    #[test]
    #[cfg(unix)]
    fn run_cmux_version_ok_returns_stdout_head() {
        let dir = temp_dir("cmux-version-head");
        let script = dir.join("fake-cmux");
        fs::write(&script, "#!/bin/sh\nprintf 'cmux 9.9.9\\ntrailing\\n'\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let out = run_cmux_version(&script).unwrap();
        assert_eq!(out, "cmux 9.9.9");
    }

    #[test]
    fn run_cmux_version_missing_is_not_found() {
        let err = run_cmux_version(Path::new("/workstation-no-such-cmux-xyz")).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn run_cmux_version_spawn_failure_is_other() {
        let dir = temp_dir("cmux-version-spawn");
        let err = run_cmux_version(&dir).unwrap_err();
        assert!(!err.is_empty());
    }
}
