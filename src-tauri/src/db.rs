use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

/// 数据库文件名（位于 `config_dir()` 下）。
const DB_FILE_NAME: &str = "workstation.db";

/// 有序迁移片段：新变更追加在末尾，历史片段只增不改。
pub const MIGRATIONS: &[&str] = &[
    // 迁移 1：壁纸搜索历史表（source + keyword 联合主键去重，updated_at 倒序索引）。
    "CREATE TABLE wallpaper_search_history (
       source    TEXT NOT NULL,
       keyword   TEXT NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (source, keyword)
     );
     CREATE INDEX idx_history_updated ON wallpaper_search_history (source, updated_at DESC);",
];

/// 解析数据库文件路径：`config_dir.join("workstation.db")`。
pub fn db_path_from(config_dir: &Path) -> PathBuf {
    config_dir.join(DB_FILE_NAME)
}

/// 平台默认数据库路径（复用 `config_dir()`，与 JSON 配置同目录）。
pub fn db_path() -> Result<PathBuf, String> {
    Ok(db_path_from(&crate::config_dir()))
}

/// 当前 schema 版本（`PRAGMA user_version`）。
pub fn schema_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("cannot read schema version: {e}"))
}

/// 打开（必要时创建）数据库：自动创建父目录，并应用全部待执行迁移。
pub fn open_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("cannot create db dir: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("cannot open database: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

/// 应用默认迁移数组中的剩余迁移。
pub fn migrate(conn: &Connection) -> Result<(), String> {
    migrate_with(conn, MIGRATIONS)
}

/// 按版本增量迁移：仅执行 `migrations[current..]` 中剩余片段，
/// 每条迁移在单个事务内执行（失败回滚且版本不变），提交成功后记录新版本。
/// 连接由调用方串行化访问（进程级单连接 + Mutex），`unchecked_transaction` 安全。
fn migrate_with(conn: &Connection, migrations: &[&str]) -> Result<(), String> {
    let current = schema_version(conn)?;
    for (idx, sql) in migrations.iter().enumerate().skip(current as usize) {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("cannot begin migration: {e}"))?;
        tx.execute_batch(sql)
            .map_err(|e| format!("migration {} failed: {e}", idx + 1))?;
        tx.commit()
            .map_err(|e| format!("cannot commit migration {}: {e}", idx + 1))?;
        conn.execute_batch(&format!("PRAGMA user_version = {}", idx + 1))
            .map_err(|e| format!("cannot record schema version: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("workstation-db-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn db_path_from_joins_config_dir() {
        let path = db_path_from(Path::new("/tmp/cfg"));
        assert_eq!(path, PathBuf::from("/tmp/cfg/workstation.db"));
    }

    #[test]
    fn db_path_resolves_platform_config_dir() {
        let path = db_path().unwrap();
        assert_eq!(path.file_name().unwrap(), "workstation.db");
        assert!(path.is_absolute());
    }

    #[test]
    fn fresh_db_applies_all_migrations() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wallpaper_search_history'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 1);
        let indexes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_history_updated'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 1);
    }

    #[test]
    fn existing_db_migrates_incrementally_and_keeps_data() {
        let dir = temp_dir("incremental");
        let path = dir.join("test.db");
        let conn = Connection::open(&path).unwrap();
        // 模拟旧库：仅应用迁移 1 并写入旧数据，版本停留在 1。
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.execute(
            "INSERT INTO wallpaper_search_history (source, keyword, updated_at) VALUES ('wallhaven', 'anime', 1)",
            [],
        )
        .unwrap();
        conn.execute_batch("PRAGMA user_version = 1").unwrap();
        drop(conn);

        let conn = open_db(&path).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len() as i64);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM wallpaper_search_history", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn failed_migration_rolls_back_without_version_change() {
        let conn = Connection::open_in_memory().unwrap();
        let bad: &[&str] = &[
            "CREATE TABLE t_ok(x INTEGER);",
            "CREATE TABLE t_rollback(x INTEGER); CREATE TABLE t_rollback(x INTEGER);",
        ];
        let err = migrate_with(&conn, bad).unwrap_err();
        assert!(!err.is_empty());
        // 第一个迁移已提交，版本推进到 1。
        assert_eq!(schema_version(&conn).unwrap(), 1);
        let ok_tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='t_ok'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ok_tables, 1);
        // 失败迁移所在事务整体回滚，未残留表。
        let rollback_tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='t_rollback'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rollback_tables, 0);
    }

    #[test]
    fn open_db_creates_missing_parent_dirs() {
        let dir = temp_dir("parents");
        let path = dir.join("nested").join("sub").join("test.db");
        let conn = open_db(&path).unwrap();
        assert!(path.exists());
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn open_db_rejects_corrupted_file() {
        let dir = temp_dir("corrupt");
        let path = dir.join("test.db");
        fs::write(&path, b"this is not a sqlite database at all").unwrap();
        let err = open_db(&path).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn open_db_errors_when_parent_is_a_file() {
        let dir = temp_dir("blocker");
        let blocker = dir.join("blocker");
        fs::write(&blocker, "i am a file, not a dir").unwrap();
        let err = open_db(&blocker.join("nested.db")).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn open_db_errors_when_path_has_no_parent_and_is_not_openable() {
        // "/" 的 parent() 为 None（跳过建目录），Connection::open 打开目录失败。
        let err = open_db(Path::new("/")).unwrap_err();
        assert!(!err.is_empty());
    }
}
