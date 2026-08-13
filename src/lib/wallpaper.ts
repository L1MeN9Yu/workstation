import { invoke } from "@tauri-apps/api/core";
import { readConfig, writeConfig } from "./configStore";
import { applyGhostyChanges, parseGhostyLines } from "./ghostyText";
import {
  readGhostyConfig,
  reloadCmuxConfig,
  reloadStatusMessage,
  writeGhostyConfig,
} from "./cmuxConfig";

export interface WallpaperItem {
  id: string;
  source: string;
  thumb_url: string;
  thumb_hash: string;
  full_url: string;
  width: number;
  height: number;
}

export interface SearchQuery {
  source: string;
  keywords: string;
  random: boolean;
  page?: number;
}

export interface SourceSettings {
  apiKey: string;
  login: string;
  categories: string;
  purity: string;
  minWidth: string;
  minHeight: string;
  rating: string;
  seed: string;
  ratios: string;
}

export interface WallpaperSettings {
  proxy: string;
  downloadDir: string;
  sources: Record<string, SourceSettings>;
}

export interface WallpaperSettingsInput {
  proxy: string;
  downloadDir: string;
  sources?: Record<string, Partial<SourceSettings>>;
}

export interface BitGroup {
  /** 选项标识，与 wallhaven API 位标记位置一一对应 */
  key: string;
  /** UI 展示的中文标签 */
  label: string;
}

/** wallhaven 三位位标记参数的位置序定义（第 1 位 / 第 2 位 / 第 3 位，与官方 API 位序一致） */
export const BIT_GROUPS: Record<string, BitGroup[]> = {
  categories: [
    { key: "General", label: "综合" },
    { key: "Anime", label: "动漫" },
    { key: "People", label: "人物" },
  ],
  purity: [
    { key: "SFW", label: "SFW" },
    { key: "Sketchy", label: "Sketchy" },
    { key: "NSFW", label: "NSFW" },
  ],
};

/**
 * 将三位位标记字符串解码为勾选集合（按位置序）。
 * 每位非 `1` 即视为未勾选（非法字符容错），空串返回空集。
 */
export function bitsToSelections(value: string, groups: BitGroup[]): string[] {
  const selected: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (value[i] === "1") {
      selected.push(groups[i].key);
    }
  }
  return selected;
}

/**
 * 将勾选集合编码为三位位标记字符串，全部不勾选输出 `"000"`。
 */
export function selectionsToBits(
  selected: string[],
  groups: BitGroup[],
): string {
  return groups.map((g) => (selected.includes(g.key) ? "1" : "0")).join("");
}

/** wallhaven 常见宽高比选项（与官方 API ratios 取值一致） */
export const RATIO_OPTIONS = [
  "16x9",
  "16x10",
  "21x9",
  "32x9",
  "48x27",
  "9x16",
  "10x16",
  "9x21",
];

/** 生成一个 wallhaven 随机搜索用的随机 seed（小写字母+数字） */
export function generateSeed(length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const DEFAULT_SOURCE_SETTINGS: SourceSettings = {
  apiKey: "",
  login: "",
  categories: "010",
  purity: "100",
  minWidth: "1920",
  minHeight: "1080",
  rating: "safe",
  seed: "",
  ratios: "",
};

export const DEFAULT_WALLPAPER_SETTINGS: WallpaperSettings = {
  proxy: "http://127.0.0.1:7890",
  downloadDir: "",
  sources: {
    wallhaven: { ...DEFAULT_SOURCE_SETTINGS },
    danbooru: {
      ...DEFAULT_SOURCE_SETTINGS,
      rating: "safe",
    },
    safebooru: {
      ...DEFAULT_SOURCE_SETTINGS,
      categories: "",
      purity: "",
      minHeight: "",
      rating: "",
    },
  },
};

const SETTINGS_KEY = "wallpaper";
const SOURCES_KEY = "wallpaperSources";

export function searchWallpapers(
  query: SearchQuery,
  settings?: WallpaperSettings,
): Promise<WallpaperItem[]> {
  return invoke<WallpaperItem[]>("search_wallpapers", { query, settings });
}

export function downloadWallpaper(item: WallpaperItem): Promise<string> {
  return invoke<string>("download_wallpaper", { item });
}

/** 拉取壁纸原图并返回 data URL（供查看器预览） */
export function previewWallpaper(item: WallpaperItem): Promise<string> {
  return invoke<string>("fetch_full_image", { item });
}

export function thumbUrl(hash: string): string {
  return `thumb://${hash}`;
}

function mergeSourceSettings(
  stored: Partial<SourceSettings> | undefined,
  defaults: SourceSettings,
): SourceSettings {
  return {
    apiKey: stored?.apiKey ?? defaults.apiKey,
    login: stored?.login ?? defaults.login,
    categories: stored?.categories ?? defaults.categories,
    purity: stored?.purity ?? defaults.purity,
    minWidth: stored?.minWidth ?? defaults.minWidth,
    minHeight: stored?.minHeight ?? defaults.minHeight,
    rating: stored?.rating ?? defaults.rating,
    seed: stored?.seed ?? defaults.seed,
    ratios: stored?.ratios ?? defaults.ratios,
  };
}

export async function loadWallpaperSettings(): Promise<WallpaperSettings> {
  const [stored, storedSources] = await Promise.all([
    readConfig<WallpaperSettingsInput>(SETTINGS_KEY),
    readConfig<{ sources?: Record<string, Partial<SourceSettings>> }>(
      SOURCES_KEY,
    ),
  ]);
  // 新 key wallpaperSources 优先，旧版 wallpaper.sources 兼容兜底
  const rawSources =
    storedSources?.sources ??
    stored?.sources ??
    DEFAULT_WALLPAPER_SETTINGS.sources;
  const sources: Record<string, SourceSettings> = {};
  for (const [id, defaults] of Object.entries(
    DEFAULT_WALLPAPER_SETTINGS.sources,
  )) {
    sources[id] = mergeSourceSettings(rawSources[id], defaults);
  }
  return {
    proxy: stored?.proxy ?? DEFAULT_WALLPAPER_SETTINGS.proxy,
    downloadDir: stored?.downloadDir ?? DEFAULT_WALLPAPER_SETTINGS.downloadDir,
    sources,
  };
}

/** 保存代理/下载目录（全局网络配置，手动保存） */
export async function saveWallpaperProxy(
  settings: Pick<WallpaperSettings, "proxy" | "downloadDir">,
): Promise<void> {
  await writeConfig(SETTINGS_KEY, settings);
}

/** 保存各图源搜索参数（高频修改，自动保存） */
export async function saveWallpaperSources(
  sources: WallpaperSettings["sources"],
): Promise<void> {
  await writeConfig(SOURCES_KEY, { sources });
}

export interface ApplyWallpaperResult {
  imagePath: string;
  reloadMessage: string;
}

export async function applyWallpaperToGhosty(
  imagePath: string,
): Promise<ApplyWallpaperResult> {
  const config = await readGhostyConfig();
  const lines = parseGhostyLines(config.content);
  const set = new Map<string, string>([["background-image", imagePath]]);
  const text = applyGhostyChanges(lines, { set, remove: new Set() });
  await writeGhostyConfig(text);
  const reload = await reloadCmuxConfig();
  return { imagePath, reloadMessage: reloadStatusMessage(reload) };
}
