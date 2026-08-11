export interface WallpaperSourceMeta {
  id: string;
  label: string;
  placeholder: string;
  supportsRandom: boolean;
  description: string;
  homepage: string;
}

export const WALLPAPER_SOURCES: WallpaperSourceMeta[] = [
  {
    id: "wallhaven",
    label: "wallhaven",
    placeholder: "关键词，如 anime、landscape",
    supportsRandom: true,
    description: "官方 API，动漫/游戏壁纸丰富，需代理访问",
    homepage: "https://wallhaven.cc",
  },
  {
    id: "danbooru",
    label: "Danbooru",
    placeholder: "标签，如 landscape、scenery",
    supportsRandom: true,
    description: "动漫图库，匿名限流约 1 次/秒",
    homepage: "https://danbooru.donmai.us",
  },
  {
    id: "safebooru",
    label: "Safebooru",
    placeholder: "标签，如 landscape",
    supportsRandom: false,
    description: "动漫图库，SFW 过滤，无需代理",
    homepage: "https://safebooru.org",
  },
];

export function getSourceMeta(id: string): WallpaperSourceMeta | undefined {
  return WALLPAPER_SOURCES.find((s) => s.id === id);
}

export function isKnownSource(id: string): boolean {
  return WALLPAPER_SOURCES.some((s) => s.id === id);
}
