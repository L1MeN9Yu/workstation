use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use log::{Level, LevelFilter, Record};
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::pattern::PatternEncoder;
use serde::Deserialize;
use tauri::Manager;

/// 当前会话固定写入的日志文件名。
pub const SESSION_LOG_FILE: &str = "workstation.log";
/// 目录内最多保留的会话归档日志份数。
pub const MAX_ARCHIVES: usize = 10;

const FILE_PATTERN: &str = "{d(%Y-%m-%d %H:%M:%S%.3f)} [{l}] {m}{n}";
const CONSOLE_PATTERN: &str = "{d(%H:%M:%S)} [{l}] {m}{n}";

pub fn session_log_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_LOG_FILE)
}

pub fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| format!("cannot resolve app log dir: {e}"))
}

fn startup_timestamp() -> String {
    Local::now().format("%Y%m%d-%H%M%S%.3f").to_string()
}

/// 归档上一会话的 `workstation.log` 为 `workstation-<启动时间戳>.log`。
/// 当前会话文件不存在时返回 `Ok(None)`；归档名冲突时追加进程号避免覆盖。
pub fn archive_previous_session(dir: &Path) -> Result<Option<PathBuf>, String> {
    let current = session_log_path(dir);
    if !current.exists() {
        return Ok(None);
    }
    let mut archived = dir.join(format!("workstation-{}.log", startup_timestamp()));
    if archived.exists() {
        archived = dir.join(format!(
            "workstation-{}-{}.log",
            startup_timestamp(),
            std::process::id()
        ));
    }
    fs::rename(&current, &archived).map_err(|e| {
        format!(
            "cannot archive previous session log {}: {e}",
            current.display()
        )
    })?;
    Ok(Some(archived))
}

/// 删除超出 `max` 份的最旧归档（`workstation-*.log`），返回删除数量。
/// 当前会话文件 `workstation.log` 不计入归档。
pub fn prune_archives(dir: &Path, max: usize) -> Result<usize, String> {
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = fs::read_dir(dir)
        .map_err(|e| format!("cannot list log dir {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("workstation-") && name.ends_with(".log") && name != SESSION_LOG_FILE
        })
        .map(|e| {
            let modified = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::UNIX_EPOCH);
            (e.path(), modified)
        })
        .collect();
    entries.sort_by_key(|(_, t)| *t);
    let excess = entries.len().saturating_sub(max);
    let mut deleted = 0;
    for (path, _) in entries.into_iter().take(excess) {
        match fs::remove_file(&path) {
            Ok(()) => deleted += 1,
            Err(e) => log::warn!("cannot remove old log archive {}: {e}", path.display()),
        }
    }
    Ok(deleted)
}

/// 从 `RUST_LOG` 环境变量解析全局日志级别，失败时默认 `info`。
/// 支持 `info,foo=debug` 形式的整体前缀解析。
pub fn level_filter() -> LevelFilter {
    std::env::var("RUST_LOG")
        .ok()
        .and_then(|v| {
            v.split(',')
                .map(|s| s.split('=').next().unwrap_or_default().trim())
                .find_map(|s| s.parse::<LevelFilter>().ok())
        })
        .unwrap_or(LevelFilter::Info)
}

fn build_config(dir: &Path, level: LevelFilter) -> Result<Config, String> {
    let file = FileAppender::builder()
        .encoder(Box::new(PatternEncoder::new(FILE_PATTERN)))
        .build(session_log_path(dir))
        .map_err(|e| format!("cannot create file appender: {e}"))?;
    let console = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new(CONSOLE_PATTERN)))
        .build();
    Config::builder()
        .appender(Appender::builder().build("file", Box::new(file)))
        .appender(Appender::builder().build("console", Box::new(console)))
        .logger(
            Logger::builder()
                .appender("file")
                .additive(false)
                .build("frontend", level),
        )
        .build(
            Root::builder()
                .appender("file")
                .appender("console")
                .build(level),
        )
        .map_err(|e| format!("cannot build log4rs config: {e}"))
}

fn init_console_only(level: LevelFilter) -> Result<(), String> {
    let console = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new(CONSOLE_PATTERN)))
        .build();
    let config = Config::builder()
        .appender(Appender::builder().build("console", Box::new(console)))
        .build(Root::builder().appender("console").build(level))
        .map_err(|e| format!("cannot build console-only log4rs config: {e}"))?;
    log4rs::init_config(config)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 初始化应用日志：写入平台日志目录的 `workstation.log`（含启动归档与清理），
/// 同时输出到控制台。文件初始化失败时降级为仅控制台输出，不导致应用崩溃。
pub fn init_logging(app: &tauri::App) -> Result<(), String> {
    match app.path().app_log_dir() {
        Ok(dir) => match init_file_logging(&dir) {
            Ok(()) => Ok(()),
            Err(e) => {
                eprintln!("[logging] file logging unavailable ({e}), falling back to console");
                init_console_only(level_filter())
            }
        },
        Err(e) => {
            eprintln!("[logging] cannot resolve app log dir ({e}), falling back to console");
            init_console_only(level_filter())
        }
    }
}

fn init_file_logging(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create log dir {}: {e}", dir.display()))?;
    let _ = archive_previous_session(dir);
    let _ = prune_archives(dir, MAX_ARCHIVES);
    let config = build_config(dir, level_filter())?;
    log4rs::init_config(config)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 前端通过 `frontend-log` 事件上报的日志载荷。
#[derive(Deserialize)]
pub struct FrontendLogPayload {
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

/// 前端日志级别字符串 → `log::Level`，未知值按 `Info` 处理。
pub fn parse_frontend_level(level: &str) -> Level {
    match level {
        "error" => Level::Error,
        "warn" => Level::Warn,
        "debug" => Level::Debug,
        _ => Level::Info,
    }
}

/// 解析前端日志载荷为 `(级别, 格式化消息)`；载荷非法时返回 `None`。
/// `source` 为 `frontend`（或缺省）时消息加 `[frontend]` 前缀标记来源。
pub fn frontend_record(payload: &str) -> Option<(Level, String)> {
    let parsed: FrontendLogPayload = serde_json::from_str(payload).ok()?;
    let is_frontend = parsed.source.as_deref().unwrap_or("frontend") == "frontend";
    let message = if is_frontend {
        format!("[frontend] {}", parsed.message)
    } else {
        parsed.message
    };
    Some((parse_frontend_level(&parsed.level), message))
}

/// 将前端上报的事件载荷写入文件日志（target = "frontend"，不输出到控制台）。
pub fn log_frontend_event(payload: &str) {
    let Some((level, message)) = frontend_record(payload) else {
        log::info!(target: "frontend", "[frontend] invalid payload");
        return;
    };
    let args = format_args!("{message}");
    let record = Record::builder()
        .args(args)
        .level(level)
        .target("frontend")
        .build();
    log::logger().log(&record);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "workstation-log-test-{name}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn session_log_path_is_fixed_name() {
        let dir = Path::new("/tmp/logs");
        assert_eq!(session_log_path(dir), dir.join("workstation.log"));
    }

    #[test]
    fn archive_previous_session_renames_existing_file() {
        let dir = temp_dir("archive-existing");
        let current = session_log_path(&dir);
        fs::write(&current, "old session log").unwrap();
        let archived = archive_previous_session(&dir).unwrap().expect("archived");
        assert!(!current.exists());
        assert!(archived.exists());
        assert_eq!(fs::read_to_string(&archived).unwrap(), "old session log");
        let name = archived.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("workstation-") && name.ends_with(".log"));
        assert_ne!(name, SESSION_LOG_FILE);
    }

    #[test]
    fn archive_previous_session_returns_none_when_no_current_file() {
        let dir = temp_dir("archive-none");
        assert!(archive_previous_session(&dir).unwrap().is_none());
    }

    #[test]
    fn archive_previous_session_avoids_collision_with_pid_suffix() {
        let dir = temp_dir("archive-collision");
        let current = session_log_path(&dir);
        fs::write(&current, "a").unwrap();
        // 预置同名归档，触发进程号后缀兜底
        let first = dir.join(format!("workstation-{}.log", startup_timestamp()));
        fs::write(&first, "old").unwrap();
        let archived = archive_previous_session(&dir).unwrap().expect("archived");
        assert_ne!(archived, first);
        assert!(archived.exists());
    }

    #[test]
    fn prune_archives_removes_oldest_beyond_max() {
        let dir = temp_dir("prune");
        for i in 0..12 {
            let path = dir.join(format!("workstation-20260801-{i:02}.log"));
            fs::write(&path, "x").unwrap();
            // 按写入顺序修改时间递增
            let secs = 1_700_000_000 + i as u64;
            let mtime = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
            let file = fs::File::open(&path).unwrap();
            let _ = file.set_modified(mtime);
        }
        let deleted = prune_archives(&dir, MAX_ARCHIVES).unwrap();
        assert_eq!(deleted, 2);
        let remaining: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("workstation-"))
            .collect();
        assert_eq!(remaining.len(), 10);
        assert!(!remaining.contains(&"workstation-20260801-00.log".to_string()));
        assert!(!remaining.contains(&"workstation-20260801-01.log".to_string()));
    }

    #[test]
    fn prune_archives_keeps_current_session_file() {
        let dir = temp_dir("prune-current");
        fs::write(session_log_path(&dir), "current").unwrap();
        let deleted = prune_archives(&dir, 0).unwrap();
        assert_eq!(deleted, 0);
        assert!(session_log_path(&dir).exists());
    }

    #[test]
    fn level_filter_defaults_to_info() {
        std::env::remove_var("RUST_LOG");
        assert_eq!(level_filter(), LevelFilter::Info);
    }

    #[test]
    fn level_filter_parses_env_var() {
        std::env::set_var("RUST_LOG", "debug");
        assert_eq!(level_filter(), LevelFilter::Debug);
        std::env::remove_var("RUST_LOG");
    }

    #[test]
    fn level_filter_parses_first_comma_segment() {
        std::env::set_var("RUST_LOG", "warn,frontend=debug");
        assert_eq!(level_filter(), LevelFilter::Warn);
        std::env::remove_var("RUST_LOG");
    }

    #[test]
    fn level_filter_falls_back_on_invalid_value() {
        std::env::set_var("RUST_LOG", "not-a-level");
        assert_eq!(level_filter(), LevelFilter::Info);
        std::env::remove_var("RUST_LOG");
    }

    #[test]
    fn parse_frontend_level_maps_all_levels() {
        assert_eq!(parse_frontend_level("error"), Level::Error);
        assert_eq!(parse_frontend_level("warn"), Level::Warn);
        assert_eq!(parse_frontend_level("debug"), Level::Debug);
        assert_eq!(parse_frontend_level("info"), Level::Info);
        assert_eq!(parse_frontend_level("nonsense"), Level::Info);
    }

    #[test]
    fn build_config_creates_file_and_console_appenders() {
        let dir = temp_dir("config");
        let config = build_config(&dir, LevelFilter::Info).unwrap();
        let appender_names: Vec<&str> = config.appenders().iter().map(|a| a.name()).collect();
        assert!(appender_names.contains(&"file"));
        assert!(appender_names.contains(&"console"));
        let logger_names: Vec<&str> = config.loggers().iter().map(|l| l.name()).collect();
        assert!(logger_names.contains(&"frontend"));
    }

    #[test]
    fn frontend_record_parses_level_and_message() {
        let payload = r#"{"level":"error","message":"boom","source":"frontend","timestamp":"2026-08-12T07:00:00Z"}"#;
        let (level, message) = frontend_record(payload).expect("parsed");
        assert_eq!(level, Level::Error);
        assert_eq!(message, "[frontend] boom");
    }

    #[test]
    fn frontend_record_falls_back_to_info_on_unknown_level() {
        let (level, message) =
            frontend_record(r#"{"level":"nonsense","message":"x"}"#).expect("parsed");
        assert_eq!(level, Level::Info);
        assert_eq!(message, "[frontend] x");
    }

    #[test]
    fn frontend_record_returns_none_on_invalid_payload() {
        assert!(frontend_record("not json").is_none());
        assert!(frontend_record(r#"{"level":"error"}"#).is_none());
    }

    #[test]
    fn frontend_record_keeps_message_for_non_frontend_source() {
        let (level, message) =
            frontend_record(r#"{"level":"warn","message":"hi","source":"other"}"#).expect("parsed");
        assert_eq!(level, Level::Warn);
        assert_eq!(message, "hi");
    }
}
