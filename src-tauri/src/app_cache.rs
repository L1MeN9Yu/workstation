use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

/// 缓存容量上限（全应用共享的条目数上限）。
pub const APP_CACHE_MAX: usize = 256;

/// 壁纸缩略图缓存命名空间。
pub const NS_THUMBS: &str = "wallpaper-thumbs";

/// 系统字体列表缓存命名空间。
pub const NS_FONTS: &str = "system-fonts";

type CacheKey = (String, String);

struct CacheEntry {
    value: Arc<dyn Any + Send + Sync>,
    last_access: u64,
}

/// 缓存统计快照（各命名空间条目数、总条目数、容量上限、命中/未命中累计）。
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCacheStats {
    pub namespaces: HashMap<String, usize>,
    pub total_entries: usize,
    pub capacity: usize,
    pub hits: u64,
    pub misses: u64,
}

/// 默认缓存容量上限：50GB（字节）。
pub const DEFAULT_CACHE_LIMIT_BYTES: u64 = 50 * 1024 * 1024 * 1024;
/// 缓存容量可配置范围：1GB – 200GB。
pub const MIN_CACHE_LIMIT_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_CACHE_LIMIT_BYTES: u64 = 200 * 1024 * 1024 * 1024;

/// app 级缓存配置（`appCache.json`）：容量上限以字节为单位，未配置时使用默认值。
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CacheSettings {
    pub cache_limit_bytes: Option<u64>,
}

impl CacheSettings {
    /// 有效缓存上限（字节）：配置值超范围时收敛到 [1GB, 200GB]，未配置用默认 50GB。
    pub fn cache_limit(&self) -> u64 {
        self.cache_limit_bytes
            .unwrap_or(DEFAULT_CACHE_LIMIT_BYTES)
            .clamp(MIN_CACHE_LIMIT_BYTES, MAX_CACHE_LIMIT_BYTES)
    }
}

/// 进程内通用 LRU 缓存：命名空间隔离、容量上限、热度淘汰、命中统计。
pub struct AppCache {
    inner: Mutex<HashMap<CacheKey, CacheEntry>>,
    clock: AtomicU64,
    hits: AtomicU64,
    misses: AtomicU64,
    capacity: usize,
}

impl AppCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            clock: AtomicU64::new(0),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            capacity,
        }
    }

    fn tick(&self) -> u64 {
        self.clock.fetch_add(1, Ordering::SeqCst)
    }

    /// 读取缓存条目：命中时刷新热度并返回值的克隆；未命中或类型不匹配返回 None（记录未命中）。
    pub fn get<T>(&self, ns: &str, key: &str) -> Option<T>
    where
        T: Clone + Send + Sync + 'static,
    {
        let mut guard = self.inner.lock().unwrap();
        let Some(entry) = guard.get_mut(&(ns.to_string(), key.to_string())) else {
            self.misses.fetch_add(1, Ordering::SeqCst);
            return None;
        };
        let Some(value) = entry.value.downcast_ref::<T>() else {
            self.misses.fetch_add(1, Ordering::SeqCst);
            return None;
        };
        entry.last_access = self.tick();
        self.hits.fetch_add(1, Ordering::SeqCst);
        Some(value.clone())
    }

    /// 写入缓存条目：容量已满且键不存在时淘汰最久未使用的条目。
    pub fn insert<T>(&self, ns: &str, key: &str, value: T)
    where
        T: Send + Sync + 'static,
    {
        let mut guard = self.inner.lock().unwrap();
        let cache_key = (ns.to_string(), key.to_string());
        if guard.len() >= self.capacity && !guard.contains_key(&cache_key) {
            if let Some(oldest) = guard
                .iter()
                .min_by_key(|(_, e)| e.last_access)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest);
            }
        }
        guard.insert(
            cache_key,
            CacheEntry {
                value: Arc::new(value),
                last_access: self.tick(),
            },
        );
    }

    /// 移除单个条目，返回是否实际移除。
    pub fn remove(&self, ns: &str, key: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .remove(&(ns.to_string(), key.to_string()))
            .is_some()
    }

    /// 清空指定命名空间下的全部条目，其他命名空间不受影响。
    pub fn clear_namespace(&self, ns: &str) {
        let mut guard = self.inner.lock().unwrap();
        guard.retain(|(ns_key, _), _| ns_key != ns);
    }

    /// 清空全部缓存条目。
    pub fn clear_all(&self) {
        self.inner.lock().unwrap().clear();
    }

    /// 生成统计快照。
    pub fn stats(&self) -> AppCacheStats {
        let mut namespaces: HashMap<String, usize> = HashMap::new();
        let guard = self.inner.lock().unwrap();
        for (ns, _) in guard.keys() {
            *namespaces.entry(ns.clone()).or_insert(0) += 1;
        }
        AppCacheStats {
            namespaces,
            total_entries: guard.len(),
            capacity: self.capacity,
            hits: self.hits.load(Ordering::SeqCst),
            misses: self.misses.load(Ordering::SeqCst),
        }
    }
}

/// 全局共享的 app 缓存实例。
pub static APP_CACHE: LazyLock<AppCache> = LazyLock::new(|| AppCache::new(APP_CACHE_MAX));

pub fn get<T>(ns: &str, key: &str) -> Option<T>
where
    T: Clone + Send + Sync + 'static,
{
    APP_CACHE.get(ns, key)
}

pub fn insert<T>(ns: &str, key: &str, value: T)
where
    T: Send + Sync + 'static,
{
    APP_CACHE.insert(ns, key, value);
}

pub fn remove(ns: &str, key: &str) -> bool {
    APP_CACHE.remove(ns, key)
}

pub fn clear_namespace(ns: &str) {
    APP_CACHE.clear_namespace(ns);
}

pub fn clear_all() {
    APP_CACHE.clear_all();
}

pub fn stats() -> AppCacheStats {
    APP_CACHE.stats()
}

/// 共享全局缓存（APP_CACHE）的测试串行锁，跨模块（wallpaper/fonts）统一使用，
/// 避免并行测试互相清空导致竞态。
#[cfg(test)]
pub static APP_CACHE_TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_cache(capacity: usize) -> AppCache {
        let cache = AppCache::new(capacity);
        cache.clear_all();
        cache
    }

    #[test]
    fn get_returns_inserted_value_and_counts_hit() {
        let cache = fresh_cache(4);
        cache.insert("ns", "k", "v".to_string());
        assert_eq!(cache.get::<String>("ns", "k"), Some("v".to_string()));
        assert_eq!(cache.get::<String>("ns", "k"), Some("v".to_string()));
        let s = cache.stats();
        assert_eq!(s.hits, 2);
        assert_eq!(s.misses, 0);
    }

    #[test]
    fn get_missing_key_returns_none_and_counts_miss() {
        let cache = fresh_cache(4);
        assert_eq!(cache.get::<String>("ns", "nope"), None);
        assert_eq!(cache.stats().misses, 1);
    }

    #[test]
    fn get_wrong_type_counts_as_miss() {
        let cache = fresh_cache(4);
        cache.insert("ns", "k", 42u32);
        assert_eq!(cache.get::<String>("ns", "k"), None);
        assert_eq!(cache.stats().misses, 1);
    }

    #[test]
    fn insert_evicts_oldest_beyond_capacity() {
        let cache = fresh_cache(2);
        cache.insert("ns", "a", 1u32);
        cache.insert("ns", "b", 2u32);
        cache.insert("ns", "c", 3u32);
        assert_eq!(cache.get::<u32>("ns", "a"), None);
        assert_eq!(cache.get::<u32>("ns", "b"), Some(2));
        assert_eq!(cache.get::<u32>("ns", "c"), Some(3));
        assert_eq!(cache.stats().total_entries, 2);
    }

    #[test]
    fn reading_refreshes_hotness_and_changes_eviction_order() {
        let cache = fresh_cache(2);
        cache.insert("ns", "a", 1u32);
        cache.insert("ns", "b", 2u32);
        assert_eq!(cache.get::<u32>("ns", "a"), Some(1));
        cache.insert("ns", "c", 3u32);
        assert_eq!(cache.get::<u32>("ns", "a"), Some(1));
        assert_eq!(cache.get::<u32>("ns", "b"), None);
        assert_eq!(cache.get::<u32>("ns", "c"), Some(3));
    }

    #[test]
    fn insert_same_key_does_not_evict() {
        let cache = fresh_cache(2);
        cache.insert("ns", "a", 1u32);
        cache.insert("ns", "a", 2u32);
        cache.insert("ns", "b", 3u32);
        assert_eq!(cache.get::<u32>("ns", "a"), Some(2));
        assert_eq!(cache.get::<u32>("ns", "b"), Some(3));
    }

    #[test]
    fn remove_deletes_single_entry() {
        let cache = fresh_cache(4);
        cache.insert("ns", "a", 1u32);
        cache.insert("ns", "b", 2u32);
        assert!(cache.remove("ns", "a"));
        assert!(!cache.remove("ns", "a"));
        assert_eq!(cache.get::<u32>("ns", "a"), None);
        assert_eq!(cache.get::<u32>("ns", "b"), Some(2));
    }

    #[test]
    fn clear_namespace_only_clears_target_ns() {
        let cache = fresh_cache(4);
        cache.insert("ns1", "k", 1u32);
        cache.insert("ns2", "k", 2u32);
        cache.clear_namespace("ns1");
        assert_eq!(cache.get::<u32>("ns1", "k"), None);
        assert_eq!(cache.get::<u32>("ns2", "k"), Some(2));
        assert_eq!(cache.stats().total_entries, 1);
    }

    #[test]
    fn clear_all_empties_cache() {
        let cache = fresh_cache(4);
        cache.insert("ns1", "k", 1u32);
        cache.insert("ns2", "k", 2u32);
        cache.clear_all();
        assert_eq!(cache.stats().total_entries, 0);
        assert!(cache.stats().namespaces.is_empty());
    }

    #[test]
    fn stats_reports_namespace_breakdown_and_capacity() {
        let cache = fresh_cache(3);
        cache.insert("ns1", "a", 1u32);
        cache.insert("ns1", "b", 2u32);
        cache.insert("ns2", "c", 3u32);
        let s = cache.stats();
        assert_eq!(s.namespaces["ns1"], 2);
        assert_eq!(s.namespaces["ns2"], 1);
        assert_eq!(s.total_entries, 3);
        assert_eq!(s.capacity, 3);
    }

    #[test]
    fn stats_counts_hits_and_misses_together() {
        let cache = fresh_cache(4);
        cache.insert("ns", "k", "v".to_string());
        let _ = cache.get::<String>("ns", "k");
        let _ = cache.get::<String>("ns", "missing");
        let s = cache.stats();
        assert_eq!(s.hits, 1);
        assert_eq!(s.misses, 1);
    }

    #[test]
    fn concurrent_reads_and_writes_are_safe() {
        let cache = fresh_cache(128);
        std::thread::scope(|scope| {
            for t in 0..8 {
                let cache = &cache;
                scope.spawn(move || {
                    for i in 0..32 {
                        cache.insert("ns", &format!("k{t}-{i}"), i as u32);
                        let _ = cache.get::<u32>("ns", &format!("k{t}-{i}"));
                    }
                });
            }
        });
        assert_eq!(cache.stats().total_entries, 128);
    }

    #[test]
    fn concurrent_clear_with_reads_is_safe() {
        let cache = fresh_cache(64);
        cache.insert("ns", "k", 1u32);
        std::thread::scope(|scope| {
            let cache = &cache;
            scope.spawn(move || {
                for _ in 0..16 {
                    cache.clear_all();
                }
            });
            scope.spawn(move || {
                for _ in 0..16 {
                    let _ = cache.get::<u32>("ns", "k");
                }
            });
        });
        assert!(cache.stats().total_entries <= 1);
    }

    #[test]
    fn cache_settings_default_is_50gb() {
        let settings = CacheSettings::default();
        assert_eq!(settings.cache_limit(), DEFAULT_CACHE_LIMIT_BYTES);
    }

    #[test]
    fn cache_settings_clamps_to_range() {
        let small = CacheSettings {
            cache_limit_bytes: Some(1),
        };
        assert_eq!(small.cache_limit(), MIN_CACHE_LIMIT_BYTES);
        let huge = CacheSettings {
            cache_limit_bytes: Some(999_999_999_999),
        };
        assert_eq!(huge.cache_limit(), MAX_CACHE_LIMIT_BYTES);
    }

    #[test]
    fn cache_settings_uses_exact_value_in_range() {
        let settings = CacheSettings {
            cache_limit_bytes: Some(5_000_000_000),
        };
        assert_eq!(settings.cache_limit(), 5_000_000_000);
    }

    #[test]
    fn cache_settings_serde_roundtrip() {
        let settings = CacheSettings {
            cache_limit_bytes: Some(10_000_000_000),
        };
        let raw = serde_json::to_string(&settings).unwrap();
        let parsed: CacheSettings = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.cache_limit_bytes, Some(10_000_000_000));
        let default_parsed: CacheSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(default_parsed.cache_limit_bytes, None);
    }

    #[test]
    fn global_singleton_clear_all_empties_everything() {
        let _guard = APP_CACHE_TEST_LOCK.lock().unwrap();
        clear_namespace("test-ns");
        insert("test-ns", "a", 1u32);
        insert("other-ns", "b", 2u32);
        clear_all();
        let s = stats();
        assert_eq!(s.total_entries, 0);
        assert!(s.namespaces.is_empty());
    }

    #[test]
    fn global_singleton_insert_and_clear() {
        let _guard = APP_CACHE_TEST_LOCK.lock().unwrap();
        clear_namespace("test-ns");
        insert("test-ns", "k", "v".to_string());
        assert_eq!(get::<String>("test-ns", "k"), Some("v".to_string()));
        assert!(remove("test-ns", "k"));
        clear_namespace("test-ns");
        assert_eq!(stats().namespaces.get("test-ns").copied().unwrap_or(0), 0);
    }
}
