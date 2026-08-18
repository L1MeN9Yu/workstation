import { invoke } from "@tauri-apps/api/core";
import { readConfig, writeConfig } from "./configStore";

/** 默认缓存容量上限：50GB（字节） */
export const DEFAULT_CACHE_LIMIT_BYTES = 50 * 1024 * 1024 * 1024;
/** 缓存容量可配置范围：1GB – 200GB */
export const MIN_CACHE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
export const MAX_CACHE_LIMIT_BYTES = 200 * 1024 * 1024 * 1024;

const CACHE_KEY = "appCache";
const WALLPAPER_KEY = "wallpaper";

export interface CacheSettings {
  cacheLimitBytes?: number;
}

/** 缓存池占用统计（后端 camelCase 返回） */
export interface CacheStats {
  totalBytes: number;
  thumbBytes: number;
  fullBytes: number;
  limitBytes: number;
}

/** 读取缓存设置并收敛到有效范围（字节）：未配置用默认 50GB。 */
export function normalizeCacheLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CACHE_LIMIT_BYTES;
  }
  return Math.min(MAX_CACHE_LIMIT_BYTES, Math.max(MIN_CACHE_LIMIT_BYTES, Math.round(value)));
}

/**
 * 读取 app 级缓存设置（`appCache.json` 的 `cacheLimitBytes`，字节）。
 * 首次调用时若 app 级未配置且旧壁纸配置存在 `cacheLimitBytes`，则一次性迁移：
 * 写入 app 级配置并清除壁纸配置中的旧字段（与 proxy 迁移模式一致）。
 * 非 Tauri 环境（invoke 失败）返回默认值。
 */
export async function getCacheSettings(): Promise<number> {
  let current: number | undefined;
  try {
    const stored = await readConfig<CacheSettings>(CACHE_KEY);
    current = stored?.cacheLimitBytes;
  } catch {
    return DEFAULT_CACHE_LIMIT_BYTES;
  }
  if (current !== undefined) {
    return normalizeCacheLimit(current);
  }
  try {
    const wp = await readConfig<
      Record<string, unknown> & { cacheLimitBytes?: number }
    >(WALLPAPER_KEY);
    const legacy = wp?.cacheLimitBytes;
    if (legacy !== undefined) {
      await writeConfig(CACHE_KEY, { cacheLimitBytes: legacy });
      const rest = { ...wp };
      delete rest.cacheLimitBytes;
      await writeConfig(WALLPAPER_KEY, rest);
      return normalizeCacheLimit(legacy);
    }
  } catch {
    // 壁纸配置读取失败不影响缓存设置读取
  }
  return DEFAULT_CACHE_LIMIT_BYTES;
}

/** 保存 app 级缓存容量上限（字节）。非法值抛错。 */
export async function saveCacheSettings(limitBytes: number): Promise<void> {
  const normalized = normalizeCacheLimit(limitBytes);
  await writeConfig(CACHE_KEY, { cacheLimitBytes: normalized });
}

/** 读取缓存池占用统计（总计 + 缩略图/原图明细 + 上限） */
export function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("get_wallpaper_cache_stats");
}

/** 清空缓存池（仅缓存文件，不影响本地壁纸库） */
export function clearCache(): Promise<void> {
  return invoke<void>("clear_wallpaper_cache");
}
