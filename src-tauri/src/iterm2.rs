use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::ser::SerializeStruct;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Iterm2ProfileFile {
    name: String,
    path: String,
    content: String,
}

pub fn iterm2_profiles_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|d| {
        d.join("Library")
            .join("Application Support")
            .join("iTerm2")
            .join("DynamicProfiles")
    })
}

pub fn list_iterm2_profiles_at(dir: &Path) -> Result<Vec<Iterm2ProfileFile>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut profiles = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(ext) = path.extension() else {
            continue;
        };
        if ext != "json" {
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        profiles.push(Iterm2ProfileFile {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.display().to_string(),
            content,
        });
    }
    Ok(profiles)
}

pub fn write_iterm2_profile_at(dir: &Path, name: &str, content: &str) -> Result<(), String> {
    let file_name = validate_profile_name(name)?;
    serde_json::from_str::<Value>(content).map_err(|e| format!("invalid JSON: {e}"))?;
    write_text_file_atomic(&dir.join(file_name), content)
}

fn validate_profile_name(name: &str) -> Result<String, String> {
    if name.is_empty() {
        return Err("invalid profile name".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("invalid profile name".to_string());
    }
    if name.contains("..") {
        return Err("invalid profile name".to_string());
    }
    if name.starts_with('.') {
        return Err("invalid profile name".to_string());
    }
    let file_name = if name.ends_with(".json") {
        name.to_string()
    } else {
        format!("{name}.json")
    };
    Ok(file_name)
}

pub fn delete_iterm2_profile_at(dir: &Path, name: &str) -> Result<(), String> {
    let file_name = validate_profile_name(name)?;
    let path = dir.join(&file_name);
    if !path.is_file() {
        return Err(format!("profile not found: {file_name}"));
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
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

#[derive(Clone, Debug, PartialEq)]
pub enum Iterm2ReloadStatus {
    Success,
    NotRunning,
    MechanismUnavailable,
    Failed(String),
}

impl Serialize for Iterm2ReloadStatus {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let (status, message) = match self {
            Iterm2ReloadStatus::Success => ("success", None),
            Iterm2ReloadStatus::NotRunning => ("notRunning", None),
            Iterm2ReloadStatus::MechanismUnavailable => ("mechanismUnavailable", None),
            Iterm2ReloadStatus::Failed(e) => ("failed", Some(e)),
        };
        let mut s = serializer.serialize_struct("Iterm2ReloadStatus", 2)?;
        s.serialize_field("status", status)?;
        if let Some(m) = message {
            s.serialize_field("message", m)?;
        }
        s.end()
    }
}

pub fn reload_iterm2_config_with(
    running: impl Fn() -> bool,
    rewrite: impl Fn() -> Result<(), String>,
) -> Result<Iterm2ReloadStatus, String> {
    if !running() {
        return Ok(Iterm2ReloadStatus::NotRunning);
    }
    match rewrite() {
        Ok(()) => Ok(Iterm2ReloadStatus::Success),
        Err(e) => Ok(Iterm2ReloadStatus::Failed(e)),
    }
}

fn reload_iterm2_with_dir(
    dir: &Path,
    running: impl Fn() -> bool,
) -> Result<Iterm2ReloadStatus, String> {
    reload_iterm2_config_with(running, || rewrite_all_profiles_at(dir))
}

fn reload_iterm2_from_dir(dir: Option<PathBuf>) -> Result<Iterm2ReloadStatus, String> {
    let Some(dir) = dir else {
        return Err("cannot resolve iTerm2 DynamicProfiles dir".to_string());
    };
    reload_iterm2_with_dir(&dir, || pgrep_is_running("iTerm2"))
}

pub fn reload_iterm2_impl() -> Result<Iterm2ReloadStatus, String> {
    reload_iterm2_from_dir(iterm2_profiles_dir())
}

fn pgrep_is_running(process: &str) -> bool {
    run_pgrep_is_running("pgrep", process)
}

fn run_pgrep_is_running(binary: &str, process: &str) -> bool {
    match Command::new(binary).args(["-x", process]).output() {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

fn rewrite_all_profiles_at(dir: &Path) -> Result<(), String> {
    for profile in list_iterm2_profiles_at(dir)? {
        write_iterm2_profile_at(dir, &profile.name, &profile.content)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("workstation-iterm2-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn iterm2_profiles_dir_points_to_dynamic_profiles() {
        let dir = iterm2_profiles_dir().expect("home dir should resolve");
        assert_eq!(dir.file_name().unwrap(), "DynamicProfiles");
        assert!(dir.to_string_lossy().contains("iTerm2"));
        let home = dirs::home_dir().unwrap();
        assert!(dir.starts_with(home));
    }

    #[test]
    fn list_iterm2_profiles_at_missing_dir_returns_empty() {
        let dir = std::env::temp_dir().join("workstation-iterm2-missing");
        assert!(list_iterm2_profiles_at(&dir).unwrap().is_empty());
    }

    #[test]
    fn list_iterm2_profiles_at_non_dir_path_returns_empty() {
        let dir = temp_dir("iterm2-non-dir");
        let file = dir.join("not-a-dir");
        fs::write(&file, "x").unwrap();
        assert!(list_iterm2_profiles_at(&file).unwrap().is_empty());
    }

    #[test]
    fn list_iterm2_profiles_at_filters_and_reads_json() {
        let dir = temp_dir("list");
        fs::write(dir.join("a.json"), r#"{"Name":"A"}"#).unwrap();
        fs::write(dir.join("work profile.json"), r#"{"Name":"B"}"#).unwrap();
        fs::write(dir.join("notes.txt"), "not json").unwrap();
        fs::write(dir.join("README"), "no ext").unwrap();
        let profiles = list_iterm2_profiles_at(&dir).unwrap();
        assert_eq!(profiles.len(), 2);
        for profile in &profiles {
            assert!(matches!(
                profile.name.as_str(),
                "a.json" | "work profile.json"
            ));
            assert!(profile.path.ends_with(&profile.name));
            assert!(!profile.content.is_empty());
        }
    }

    #[test]
    fn list_iterm2_profiles_at_errors_on_unreadable_file() {
        let dir = temp_dir("list-unreadable");
        let path = dir.join("locked.json");
        fs::write(&path, "{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
            assert!(list_iterm2_profiles_at(&dir).is_err());
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        }
        #[cfg(not(unix))]
        {
            // Reading a directory entry as a file is an error on non-unix.
            let sub = dir.join("sub.json");
            fs::create_dir_all(&sub).unwrap();
            assert!(list_iterm2_profiles_at(&dir).is_err());
        }
    }

    #[test]
    fn list_iterm2_profiles_at_errors_on_unreadable_dir() {
        #[cfg(unix)]
        {
            let dir = temp_dir("list-unreadable-dir");
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
            assert!(list_iterm2_profiles_at(&dir).is_err());
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn write_iterm2_profile_at_rejects_unsafe_names() {
        let dir = temp_dir("names");
        for bad in ["", "a/b", "a\\b", "a..b", "..", ".hidden"] {
            assert!(
                write_iterm2_profile_at(&dir, bad, "{}").is_err(),
                "name {bad:?} should be rejected"
            );
        }
        assert!(write_iterm2_profile_at(&dir, "valid name", "{}").is_ok());
    }

    #[test]
    fn write_iterm2_profile_at_rejects_invalid_json_without_writing() {
        let dir = temp_dir("json-invalid");
        let err = write_iterm2_profile_at(&dir, "bad.json", "not json").unwrap_err();
        assert!(err.contains("invalid JSON"));
        assert!(!dir.join("bad.json").exists());
    }

    #[test]
    fn write_iterm2_profile_at_writes_json_with_suffix() {
        let dir = temp_dir("write");
        write_iterm2_profile_at(&dir, "my profile", r#"{"Name":"X"}"#).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("my profile.json")).unwrap(),
            r#"{"Name":"X"}"#
        );
        write_iterm2_profile_at(&dir, "other.json", "{}").unwrap();
        assert_eq!(fs::read_to_string(dir.join("other.json")).unwrap(), "{}");
        // no temp leftovers
        let leftover: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("tmp-"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind");
    }

    #[test]
    fn delete_iterm2_profile_at_removes_existing_file() {
        let dir = temp_dir("delete-ok");
        fs::write(dir.join("del.json"), "{}").unwrap();
        delete_iterm2_profile_at(&dir, "del.json").unwrap();
        assert!(!dir.join("del.json").exists());
    }

    #[test]
    fn delete_iterm2_profile_at_missing_file_is_error() {
        let dir = temp_dir("delete-missing");
        let err = delete_iterm2_profile_at(&dir, "nope.json").unwrap_err();
        assert!(err.contains("profile not found"));
    }

    #[test]
    fn delete_iterm2_profile_at_rejects_unsafe_names() {
        let dir = temp_dir("delete-names");
        for bad in ["", "a/b", "a..b", ".hidden"] {
            assert!(delete_iterm2_profile_at(&dir, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn delete_iterm2_profile_at_errors_on_unwritable_dir() {
        #[cfg(unix)]
        {
            let dir = temp_dir("delete-unwritable");
            fs::write(dir.join("x.json"), "{}").unwrap();
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
            assert!(delete_iterm2_profile_at(&dir, "x.json").is_err());
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn write_iterm2_profile_at_errors_on_unwritable_dir() {
        let dir = temp_dir("unwritable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
            assert!(write_iterm2_profile_at(&dir, "x.json", "{}").is_err());
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(not(unix))]
        {
            let blocker = dir.join("blocker");
            fs::write(&blocker, "i am a file").unwrap();
            let path = blocker.join("nested").join("x.json");
            assert!(write_text_file_atomic(&path, "{}").is_err());
        }
    }

    #[test]
    fn write_text_file_atomic_creates_parent_dirs() {
        let dir = temp_dir("atomic-parents");
        let path = dir.join("nested").join("deep").join("config");
        write_text_file_atomic(&path, "hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
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
        let leftover: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("tmp-"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind");
    }

    #[test]
    fn write_text_file_atomic_errors_when_parent_is_a_file() {
        let dir = temp_dir("atomic-parent-file");
        let blocker = dir.join("blocker");
        fs::write(&blocker, "i am a file, not a dir").unwrap();
        let path = blocker.join("nested").join("data.json");
        assert!(write_text_file_atomic(&path, "{}").is_err());
    }

    #[test]
    fn iterm2_reload_status_serializes_as_flat_object() {
        let success = serde_json::to_value(Iterm2ReloadStatus::Success).unwrap();
        assert_eq!(success, serde_json::json!({"status": "success"}));
        let not_running = serde_json::to_value(Iterm2ReloadStatus::NotRunning).unwrap();
        assert_eq!(not_running, serde_json::json!({"status": "notRunning"}));
        let mechanism = serde_json::to_value(Iterm2ReloadStatus::MechanismUnavailable).unwrap();
        assert_eq!(
            mechanism,
            serde_json::json!({"status": "mechanismUnavailable"})
        );
        let failed = serde_json::to_value(Iterm2ReloadStatus::Failed("boom".to_string())).unwrap();
        assert_eq!(
            failed,
            serde_json::json!({"status": "failed", "message": "boom"})
        );
    }

    #[test]
    fn reload_iterm2_config_with_not_running_returns_not_running() {
        let status = reload_iterm2_config_with(|| false, || Ok(())).unwrap();
        assert_eq!(status, Iterm2ReloadStatus::NotRunning);
    }

    #[test]
    fn reload_iterm2_config_with_running_and_ok_rewrite_is_success() {
        let status = reload_iterm2_config_with(|| true, || Ok(())).unwrap();
        assert_eq!(status, Iterm2ReloadStatus::Success);
    }

    #[test]
    fn reload_iterm2_config_with_running_and_failed_rewrite_is_failed() {
        let status = reload_iterm2_config_with(|| true, || Err("boom".to_string())).unwrap();
        assert_eq!(status, Iterm2ReloadStatus::Failed("boom".to_string()));
    }

    #[test]
    fn reload_iterm2_with_dir_running_true_rewrites_profiles() {
        let dir = temp_dir("reload-ok");
        fs::write(dir.join("p.json"), r#"{"Name":"P"}"#).unwrap();
        let status = reload_iterm2_with_dir(&dir, || true).unwrap();
        assert_eq!(status, Iterm2ReloadStatus::Success);
        assert_eq!(
            fs::read_to_string(dir.join("p.json")).unwrap(),
            r#"{"Name":"P"}"#
        );
    }

    #[test]
    fn reload_iterm2_with_dir_rewrite_list_failure_is_failed() {
        let dir = temp_dir("reload-list-err");
        fs::write(dir.join("p.json"), "{}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join("p.json"), fs::Permissions::from_mode(0o000)).unwrap();
            let status = reload_iterm2_with_dir(&dir, || true).unwrap();
            assert!(matches!(status, Iterm2ReloadStatus::Failed(_)));
            fs::set_permissions(dir.join("p.json"), fs::Permissions::from_mode(0o644)).unwrap();
        }
    }

    #[test]
    fn reload_iterm2_with_dir_rewrite_write_failure_is_failed() {
        let dir = temp_dir("reload-write-err");
        fs::write(dir.join("p.json"), "not json").unwrap();
        let status = reload_iterm2_with_dir(&dir, || true).unwrap();
        assert!(matches!(status, Iterm2ReloadStatus::Failed(_)));
    }

    #[test]
    fn reload_iterm2_with_dir_not_running_returns_not_running() {
        let dir = temp_dir("reload-not-running");
        let status = reload_iterm2_with_dir(&dir, || false).unwrap();
        assert_eq!(status, Iterm2ReloadStatus::NotRunning);
    }

    #[test]
    fn reload_iterm2_from_dir_none_returns_error() {
        let err = reload_iterm2_from_dir(None).unwrap_err();
        assert!(err.contains("cannot resolve iTerm2 DynamicProfiles dir"));
    }

    #[test]
    fn reload_iterm2_impl_returns_valid_status() {
        // Environment-independent: succeeds when iTerm2 is running, otherwise
        // reports notRunning/failed; the result must still be a defined status.
        let status = reload_iterm2_impl().unwrap();
        assert!(matches!(
            status,
            Iterm2ReloadStatus::Success
                | Iterm2ReloadStatus::NotRunning
                | Iterm2ReloadStatus::Failed(_)
        ));
    }

    #[test]
    fn pgrep_running_detection_branches() {
        #[cfg(unix)]
        {
            assert!(run_pgrep_is_running("true", "x"));
            assert!(!run_pgrep_is_running("false", "x"));
        }
        assert!(!run_pgrep_is_running("workstation-no-such-binary-xyz", "x"));
    }
}
