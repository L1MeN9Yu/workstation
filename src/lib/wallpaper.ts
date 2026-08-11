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

export const DEFAULT_SOURCE_SETTINGS: SourceSettings = {
  apiKey: "",
  login: "",
  categories: "010",
  purity: "100",
  minWidth: "1920",
  minHeight: "1080",
  rating: "safe",
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

export function searchWallpapers(query: SearchQuery): Promise<WallpaperItem[]> {
  return invoke<WallpaperItem[]>("search_wallpapers", { query });
}

export function downloadWallpaper(item: WallpaperItem): Promise<string> {
  return invoke<string>("download_wallpaper", { item });
}

export function fetchWallpaperThumb(url: string): Promise<string> {
  return invoke<string>("fetch_remote_image", { url });
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
  };
}

export async function loadWallpaperSettings(): Promise<WallpaperSettings> {
  const stored = await readConfig<WallpaperSettingsInput>(SETTINGS_KEY);
  const sources: Record<string, SourceSettings> = {};
  for (const [id, defaults] of Object.entries(
    DEFAULT_WALLPAPER_SETTINGS.sources,
  )) {
    sources[id] = mergeSourceSettings(stored?.sources?.[id], defaults);
  }
  return {
    proxy: stored?.proxy ?? DEFAULT_WALLPAPER_SETTINGS.proxy,
    downloadDir: stored?.downloadDir ?? DEFAULT_WALLPAPER_SETTINGS.downloadDir,
    sources,
  };
}

export async function saveWallpaperSettings(
  settings: WallpaperSettings,
): Promise<void> {
  await writeConfig(SETTINGS_KEY, settings);
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
