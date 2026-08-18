use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use log::{Level, LevelFilter, Record};
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::pattern::PatternEncoder;
use serde::Deserialize;

/// 当前会话固定写入的日志文件名。
pub const SESSION_LOG_FILE: &str = "workstation.log";
/// 目录内最多保留的会话归档日志份数。
pub const MAX_ARCHIVES: usize = 10;

const FILE_PATTERN: &str = "{d(%Y-%m-%d %H:%M:%S%.3f)} [{l}] {m}{n}";
const CONSOLE_PATTERN: &str = "{d(%H:%M:%S)} [{l}] {m}{n}";

pub fn session_log_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_LOG_FILE)
}

/// 解析当前会话日志文件路径：目录解析成功时拼接会话文件名，失败时透传错误。
/// 目录结果由调用方（tauri 壳）注入，便于单元测试覆盖成功与失败分支。
pub fn current_log_file_with(log_dir_result: Result<PathBuf, String>) -> Result<PathBuf, String> {
    log_dir_result.map(|dir| session_log_path(&dir))
}

fn startup_timestamp() -> String {
    Local::now().format("%Y%m%d-%H%M%S%.3f").to_string()
}

/// 归档上一会话的 `workstation.log` 为 `workstation-<启动时间戳>.log`。
/// 当前会话文件不存在时返回 `Ok(None)`；归档名冲突时追加进程号避免覆盖。
pub fn archive_previous_session(dir: &Path) -> Result<Option<PathBuf>, String> {
    archive_previous_session_at(dir, &startup_timestamp())
}

fn archive_previous_session_at(dir: &Path, timestamp: &str) -> Result<Option<PathBuf>, String> {
    let current = session_log_path(dir);
    if !current.exists() {
        return Ok(None);
    }
    let mut archived = dir.join(format!("workstation-{timestamp}.log"));
    if archived.exists() {
        archived = dir.join(format!(
            "workstation-{timestamp}-{}.log",
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

/// 带降级的日志初始化编排：目录可解析且文件日志初始化成功 → `Ok`；
/// 否则降级为 console-init。两级失败路径与成功路径均由测试覆盖，
/// tauri 壳（`init_logging`）位于 `runtime.rs`（CI 覆盖率忽略该文件）。
pub fn init_logging_with_fallbacks(
    log_dir_result: Result<PathBuf, String>,
    file_init: impl FnOnce(&Path, LevelFilter) -> Result<(), String>,
    console_init: impl FnOnce(LevelFilter) -> Result<(), String>,
) -> Result<(), String> {
    match log_dir_result {
        Ok(dir) => match file_init(&dir, level_filter()) {
            Ok(()) => Ok(()),
            Err(e) => {
                eprintln!("[logging] file logging unavailable ({e}), falling back to console");
                console_init(level_filter())
            }
        },
        Err(e) => {
            eprintln!("[logging] cannot resolve app log dir ({e}), falling back to console");
            console_init(level_filter())
        }
    }
}

/// 文件日志初始化：创建目录 → 归档上一会话 → 清理过期归档 → 构建配置并初始化。
/// 初始化动作通过 `init` 注入，便于单元测试覆盖全部路径。
pub fn init_file_logging(
    dir: &Path,
    level: LevelFilter,
    init: impl FnOnce(Config) -> Result<(), String>,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create log dir {}: {e}", dir.display()))?;
    let _ = archive_previous_session(dir);
    let _ = prune_archives(dir, MAX_ARCHIVES);
    let config = build_config(dir, level)?;
    init(config)
}

pub fn build_console_config(level: LevelFilter) -> Config {
    let console = ConsoleAppender::builder()
        .encoder(Box::new(PatternEncoder::new(CONSOLE_PATTERN)))
        .build();
    Config::builder()
        .appender(Appender::builder().build("console", Box::new(console)))
        .build(Root::builder().appender("console").build(level))
        .expect("console-only config is statically valid")
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

    /// 保护 `RUST_LOG` 环境变量读写的互斥锁：多个测试并行运行时互相干扰（Windows 偶发）
    static RUST_LOG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    fn current_log_file_joins_session_file_when_dir_resolves() {
        let dir = PathBuf::from("/tmp/logs");
        let got = current_log_file_with(Ok(dir.clone())).unwrap();
        assert_eq!(got, session_log_path(&dir));
    }

    #[test]
    fn current_log_file_propagates_dir_error() {
        let err = current_log_file_with(Err("cannot resolve app log dir".to_string())).unwrap_err();
        assert_eq!(err, "cannot resolve app log dir");
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
    fn archive_previous_session_at_appends_pid_on_ts_collision() {
        let dir = temp_dir("archive-at-collision");
        fs::write(session_log_path(&dir), "a").unwrap();
        let first = dir.join("workstation-20260812-120000.000.log");
        fs::write(&first, "old").unwrap();
        let archived = archive_previous_session_at(&dir, "20260812-120000.000")
            .unwrap()
            .expect("archived");
        assert_ne!(archived, first);
        let name = archived.file_name().unwrap().to_string_lossy().to_string();
        assert!(name.starts_with("workstation-20260812-120000.000-"));
    }

    #[test]
    fn archive_previous_session_at_errors_when_rename_fails() {
        let dir = temp_dir("archive-at-err");
        fs::write(session_log_path(&dir), "a").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
            let err = archive_previous_session_at(&dir, "20260812-120000.000").unwrap_err();
            assert!(err.contains("cannot archive previous session log"));
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        #[cfg(not(unix))]
        {
            let _ = archive_previous_session_at(&dir, "20260812-120000.000");
        }
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
    fn prune_archives_warns_and_keeps_undelatable_entry() {
        let dir = temp_dir("prune-undel");
        // 同名"目录"无法 remove_file，触发 warn 分支且不计入删除数
        let stubborn = dir.join("workstation-20260801-00.log");
        fs::create_dir_all(&stubborn).unwrap();
        let regular = dir.join("workstation-20260801-01.log");
        fs::write(&regular, "x").unwrap();
        // 最旧的（stubborn 目录）删除失败 → 计入 warn，不增加 deleted 计数
        let deleted = prune_archives(&dir, 1).unwrap();
        assert_eq!(deleted, 0);
        assert!(stubborn.exists(), "undelatable entry should remain");
        assert!(regular.exists());
    }

    #[test]
    fn level_filter_defaults_to_info() {
        let _guard = RUST_LOG_LOCK.lock().unwrap();
        std::env::remove_var("RUST_LOG");
        assert_eq!(level_filter(), LevelFilter::Info);
    }

    #[test]
    fn level_filter_parses_env_var() {
        let _guard = RUST_LOG_LOCK.lock().unwrap();
        std::env::set_var("RUST_LOG", "debug");
        assert_eq!(level_filter(), LevelFilter::Debug);
        std::env::remove_var("RUST_LOG");
    }

    #[test]
    fn level_filter_parses_first_comma_segment() {
        let _guard = RUST_LOG_LOCK.lock().unwrap();
        std::env::set_var("RUST_LOG", "warn,frontend=debug");
        assert_eq!(level_filter(), LevelFilter::Warn);
        std::env::remove_var("RUST_LOG");
    }

    #[test]
    fn level_filter_falls_back_on_invalid_value() {
        let _guard = RUST_LOG_LOCK.lock().unwrap();
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

    #[test]
    fn log_frontend_event_accepts_valid_payload() {
        // 无全局 logger 时 log() 为 no-op，调用不应 panic 或产生副作用
        log_frontend_event(r#"{"level":"error","message":"boom"}"#);
    }

    #[test]
    fn log_frontend_event_accepts_invalid_payload() {
        log_frontend_event("not json");
    }

    #[test]
    fn init_file_logging_archives_previous_session_first() {
        let dir = temp_dir("init-archive");
        fs::write(session_log_path(&dir), "old").unwrap();
        let mut inits = 0;
        init_file_logging(&dir, LevelFilter::Info, |_| {
            inits += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(inits, 1);
        // 旧会话内容已归档（FileAppender 构建时会重新创建当前文件）
        let archives: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("workstation-") && n.ends_with(".log"))
            .collect();
        assert_eq!(archives.len(), 1);
        let archived = dir.join(&archives[0]);
        assert_eq!(fs::read_to_string(&archived).unwrap(), "old");
    }

    #[test]
    fn init_file_logging_propagates_init_error() {
        let dir = temp_dir("init-err");
        let err = init_file_logging(&dir, LevelFilter::Info, |_| Err("init boom".to_string()))
            .unwrap_err();
        assert_eq!(err, "init boom");
    }

    #[test]
    fn init_file_logging_propagates_create_dir_error() {
        let dir = temp_dir("init-nodir");
        let blocker = dir.join("blocker");
        fs::write(&blocker, "file not dir").unwrap();
        let err =
            init_file_logging(&blocker.join("nested"), LevelFilter::Info, |_| Ok(())).unwrap_err();
        assert!(err.contains("cannot create log dir"));
    }

    #[test]
    fn init_console_config_builds_console_appender() {
        let config = build_console_config(LevelFilter::Debug);
        assert!(config.appenders().iter().any(|a| a.name() == "console"));
    }

    #[test]
    fn init_logging_with_falls_back_to_console_when_file_init_fails() {
        let dir = temp_dir("init-fallback-file");
        let blocker = dir.join("blocker");
        fs::write(&blocker, "x").unwrap();
        let mut console_level = None;
        let result = init_logging_with_fallbacks(
            Ok(blocker.join("nested")),
            |_dir, _level| Err("file boom".to_string()),
            |level| {
                console_level = Some(level);
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert_eq!(console_level, Some(LevelFilter::Info));
    }

    fn ok_file_init(_dir: &Path, _level: LevelFilter) -> Result<(), String> {
        Ok(())
    }

    fn ok_console_init(_level: LevelFilter) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn ok_console_init_succeeds() {
        assert!(ok_console_init(LevelFilter::Info).is_ok());
    }

    #[test]
    fn init_logging_with_falls_back_to_console_when_dir_resolution_fails() {
        let mut console_called = false;
        let result =
            init_logging_with_fallbacks(Err("no log dir".to_string()), ok_file_init, |_| {
                console_called = true;
                Ok(())
            });
        assert!(result.is_ok());
        assert!(console_called);
    }

    #[test]
    fn init_logging_with_propagates_console_init_error() {
        let result =
            init_logging_with_fallbacks(Err("no log dir".to_string()), ok_file_init, |_| {
                Err("console boom".to_string())
            });
        assert_eq!(result.unwrap_err(), "console boom");
    }

    #[test]
    fn init_logging_with_ok_dir_uses_file_path_when_file_init_succeeds() {
        let dir = temp_dir("init-ok-logging");
        let result = init_logging_with_fallbacks(Ok(dir.clone()), ok_file_init, ok_console_init);
        assert!(result.is_ok());
    }
}
