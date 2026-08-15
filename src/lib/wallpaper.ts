import { invoke } from "@tauri-apps/api/core";
import { readConfig, writeConfig } from "./configStore";
import { applyGhostyChanges, parseGhostyLines } from "./ghostyText";
import {
  readGhostyConfig,
  reloadCmuxConfig,
  reloadStatusMessage,
  writeGhostyConfig,
} from "./cmuxConfig";
import {
  listIterm2Profiles,
  reloadIterm2Config,
  reloadStatusMessage as iterm2ReloadStatus,
  writeIterm2Profile,
} from "./iterm2Config";

/** 壁纸应用目标：cmux（写入 ghosty 配置）或 iTerm2（写入 Dynamic Profile） */
export type ApplyWallpaperTarget = "cmux" | "iterm2";

/** 本地壁纸库中的一张壁纸文件信息 */
export interface LocalWallpaperInfo {
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedAtMs: number;
  thumbDataUrl: string;
}

/** 批量删除本地壁纸的汇总结果 */
export interface DeleteWallpapersResult {
  deleted: string[];
  errors: string[];
}

/** 将字节数格式化为人类可读大小（B/KB/MB/GB） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 将 epoch 毫秒格式化为本地时间 `YYYY-MM-DD HH:mm` */
export function formatModifiedTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** 按修改时间从新到旧排序（防御性：后端已排序） */
export function sortByModifiedDesc(items: LocalWallpaperInfo[]): LocalWallpaperInfo[] {
  return [...items].sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
}

/** 列出本地壁纸目录中的壁纸文件 */
export function listLocalWallpapers(settings?: WallpaperSettings): Promise<LocalWallpaperInfo[]> {
  return invoke<LocalWallpaperInfo[]>("list_local_wallpapers", { settings });
}

/** 生成单张本地壁纸的缩略图 data URL（列表秒回后逐张并行拉取） */
export function fetchWallpaperThumb(path: string): Promise<string> {
  return invoke<string>("wallpaper_thumb", { path });
}

/** 读取本地壁纸文件并返回 data URL（大图预览用） */
export function readLocalWallpaperFile(path: string): Promise<string> {
  return invoke<string>("read_local_wallpaper_file", { path });
}

/** 批量删除本地壁纸文件 */
export function deleteLocalWallpapers(paths: string[]): Promise<DeleteWallpapersResult> {
  return invoke<DeleteWallpapersResult>("delete_local_wallpapers", { paths });
}


/** 将 iTerm2 配置重载状态转为用户可读消息 */
export function iterm2ReloadStatusMessage(
  result: Awaited<ReturnType<typeof reloadIterm2Config>>,
): string {
  return iterm2ReloadStatus(result);
}

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
  downloadDir: string;
  /** 默认壁纸应用目标 */
  defaultApplyTarget: ApplyWallpaperTarget;
  /** iTerm2 目标 Dynamic Profile 名称（应用目标为 iterm2 时使用） */
  iterm2Profile: string;
  sources: Record<string, SourceSettings>;
}

export interface WallpaperSettingsInput {
  downloadDir: string;
  defaultApplyTarget?: ApplyWallpaperTarget;
  iterm2Profile?: string;
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
  downloadDir: "",
  defaultApplyTarget: "cmux",
  iterm2Profile: "",
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
    downloadDir: stored?.downloadDir ?? DEFAULT_WALLPAPER_SETTINGS.downloadDir,
    defaultApplyTarget:
      stored?.defaultApplyTarget ??
      DEFAULT_WALLPAPER_SETTINGS.defaultApplyTarget,
    iterm2Profile:
      stored?.iterm2Profile ?? DEFAULT_WALLPAPER_SETTINGS.iterm2Profile,
    sources,
  };
}

/** 保存代理/下载目录/应用目标（全局网络配置，手动保存） */
export async function saveWallpaperProxy(
  settings: Pick<
    WallpaperSettings,
    "downloadDir" | "defaultApplyTarget" | "iterm2Profile"
  >,
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
  target: ApplyWallpaperTarget;
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
  return {
    imagePath,
    target: "cmux",
    reloadMessage: reloadStatusMessage(reload),
  };
}

/**
 * 将壁纸应用到指定 iTerm2 Dynamic Profile 的 Background Image Location 并重载。
 * profile 不存在或 JSON 解析失败时不写入任何文件。
 */
export async function applyWallpaperToIt(
  imagePath: string,
  profileName: string,
): Promise<ApplyWallpaperResult> {
  const profiles = await listIterm2Profiles();
  const profile = profiles.find((p) => p.name === profileName);
  if (!profile) {
    throw new Error(`iTerm2 Profile 不存在：${profileName}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(profile.content);
  } catch (e) {
    const err = new Error(`iTerm2 Profile JSON 解析失败：${String(e)}`);
    Object.assign(err, { cause: e });
    throw err;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`iTerm2 Profile 内容不是 JSON 对象：${profileName}`);
  }
  const record = data as Record<string, unknown>;
  // 兼容 iTerm2 导出格式 {"Profiles":[{...}]}：属性写入 Profiles[0]；扁平 JSON 直接写顶层
  let targetProfile = record;
  if (Array.isArray(record.Profiles)) {
    if (record.Profiles.length === 0) {
      throw new Error(`iTerm2 Profile 的 Profiles 列表为空：${profileName}`);
    }
    const first = record.Profiles[0];
    if (typeof first !== "object" || first === null || Array.isArray(first)) {
      throw new Error(`iTerm2 Profile 的 Profiles[0] 不是 JSON 对象：${profileName}`);
    }
    targetProfile = first as Record<string, unknown>;
  }
  targetProfile["Background Image Location"] = imagePath;
  await writeIterm2Profile(profile.name, JSON.stringify(record));
  const reload = await reloadIterm2Config();
  return {
    imagePath,
    target: "iterm2",
    reloadMessage: iterm2ReloadStatusMessage(reload),
  };
}

/** 按目标分发壁纸应用：cmux 走 ghosty 配置，iterm2 需提供目标 Profile 名 */
export async function applyWallpaper(
  imagePath: string,
  target: ApplyWallpaperTarget,
  profileName?: string,
): Promise<ApplyWallpaperResult> {
  if (target === "cmux") {
    return applyWallpaperToGhosty(imagePath);
  }
  if (target === "iterm2") {
    if (!profileName) {
      throw new Error("应用目标为 iTerm2 时需指定 Profile");
    }
    return applyWallpaperToIt(imagePath, profileName);
  }
  throw new Error(`未知的应用目标：${target}`);
}
