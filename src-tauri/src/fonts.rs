use std::collections::HashSet;
use std::sync::Mutex;

pub fn unique_families(faces: &[fontdb::FaceInfo]) -> Vec<String> {
    let mut seen = HashSet::new();
    for face in faces {
        if let Some((name, _)) = face.families.first() {
            seen.insert(name.clone());
        }
    }
    let mut names: Vec<String> = seen.into_iter().collect();
    names.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| b.cmp(a))
    });
    names
}

pub fn list_font_families_with(load: impl Fn() -> Vec<fontdb::FaceInfo>) -> Vec<String> {
    unique_families(&load())
}

/// 进程内字体列表缓存（Tauri managed state）。首次枚举后复用，避免重复全量扫描。
#[derive(Default)]
pub struct FontCache(pub Mutex<Option<Vec<String>>>);

pub fn list_font_families_cached(
    cache: &Mutex<Option<Vec<String>>>,
    load: impl Fn() -> Vec<fontdb::FaceInfo>,
) -> Vec<String> {
    {
        let guard = cache.lock().unwrap();
        if let Some(families) = guard.as_ref() {
            return families.clone();
        }
    }
    let families = list_font_families_with(load);
    let mut guard = cache.lock().unwrap();
    *guard = Some(families.clone());
    families
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(family: Option<&str>) -> fontdb::FaceInfo {
        fontdb::FaceInfo {
            id: fontdb::ID::dummy(),
            source: fontdb::Source::File(std::path::PathBuf::from("/fake.ttf")),
            families: family
                .map(|f| vec![(f.to_string(), fontdb::Language::English_UnitedStates)])
                .unwrap_or_default(),
            post_script_name: String::new(),
            style: fontdb::Style::Normal,
            weight: fontdb::Weight::NORMAL,
            stretch: fontdb::Stretch::Normal,
            monospaced: false,
            index: 0,
        }
    }

    #[test]
    fn unique_families_deduplicates_identical_family() {
        let faces = vec![face(Some("Arial")), face(Some("Arial"))];
        assert_eq!(unique_families(&faces), vec!["Arial".to_string()]);
    }

    #[test]
    fn unique_families_sorts_case_insensitively() {
        let faces = vec![
            face(Some("Avenir")),
            face(Some("arial")),
            face(Some("Arial")),
        ];
        assert_eq!(
            unique_families(&faces),
            vec![
                "arial".to_string(),
                "Arial".to_string(),
                "Avenir".to_string()
            ]
        );
    }

    #[test]
    fn unique_families_sorts_mixed_chinese_and_digits() {
        let faces = vec![
            face(Some("中文2")),
            face(Some("中文10")),
            face(Some("中文1")),
        ];
        assert_eq!(
            unique_families(&faces),
            vec![
                "中文1".to_string(),
                "中文10".to_string(),
                "中文2".to_string()
            ]
        );
    }

    #[test]
    fn unique_families_empty_faces_returns_empty() {
        assert!(unique_families(&[]).is_empty());
    }

    #[test]
    fn unique_families_skips_faces_without_families() {
        let faces = vec![face(None), face(Some("Menlo")), face(None)];
        assert_eq!(unique_families(&faces), vec!["Menlo".to_string()]);
    }

    #[test]
    fn list_font_families_with_empty_loader_returns_empty() {
        assert!(list_font_families_with(Vec::new).is_empty());
    }

    #[test]
    fn list_font_families_with_runs_full_pipeline() {
        let families = list_font_families_with(|| {
            vec![
                face(Some("Menlo")),
                face(Some("menlo")),
                face(Some("SF Mono")),
            ]
        });
        assert_eq!(
            families,
            vec![
                "menlo".to_string(),
                "Menlo".to_string(),
                "SF Mono".to_string()
            ]
        );
    }

    #[test]
    fn cached_enumeration_loads_on_miss_and_stores() {
        let cache = Mutex::new(None);
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let families = list_font_families_cached(&cache, || {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            sample_faces()
        });
        assert_eq!(families, vec!["Arial".to_string(), "Menlo".to_string()]);
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(
            *cache.lock().unwrap(),
            Some(vec!["Arial".to_string(), "Menlo".to_string()])
        );
    }

    fn sample_faces() -> Vec<fontdb::FaceInfo> {
        vec![face(Some("Menlo")), face(Some("Arial"))]
    }

    #[test]
    fn cached_enumeration_reuses_cache_without_reloading() {
        let cache = Mutex::new(Some(vec!["Menlo".to_string()]));
        // 缓存命中时 load 不被执行（若执行则返回 Skipped），证明复用缓存。
        let families = list_font_families_cached(&cache, || vec![face(Some("Skipped"))]);
        assert_eq!(families, vec!["Menlo".to_string()]);
        assert_eq!(*cache.lock().unwrap(), Some(vec!["Menlo".to_string()]));
    }

    #[test]
    fn cached_enumeration_empty_load_still_caches_empty() {
        let cache = Mutex::new(None);
        let families = list_font_families_cached(&cache, Vec::new);
        assert!(families.is_empty());
        assert_eq!(*cache.lock().unwrap(), Some(vec![]));
    }

    #[test]
    fn cached_enumeration_concurrent_reads_are_safe() {
        let cache = Mutex::new(Some(vec!["Menlo".to_string()]));
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for _ in 0..8 {
                let cache = &cache;
                handles.push(scope.spawn(move || list_font_families_cached(cache, Vec::new)));
            }
            for handle in handles {
                assert_eq!(handle.join().unwrap(), vec!["Menlo".to_string()]);
            }
        });
    }

    #[test]
    fn font_cache_default_is_unpopulated() {
        let cache = FontCache::default();
        assert!(cache.0.lock().unwrap().is_none());
    }
}
