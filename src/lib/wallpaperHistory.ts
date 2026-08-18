import { invoke } from "@tauri-apps/api/core";

/** 单条搜索历史记录 */
export interface WallpaperHistoryItem {
  source: string;
  keyword: string;
  updatedAt: number;
}

/** 搜索历史分页响应 */
export interface WallpaperHistoryPage {
  total: number;
  page: number;
  pageSize: number;
  items: WallpaperHistoryItem[];
}

/** 历史区块每页条数 */
export const HISTORY_PAGE_SIZE = 8;

/** 分页拉取某图源的搜索历史（page 从 1 起，按最近使用排序） */
export function listWallpaperHistory(
  source: string,
  page: number,
  pageSize: number,
): Promise<WallpaperHistoryPage> {
  return invoke<WallpaperHistoryPage>("list_wallpaper_history", {
    source,
    page,
    pageSize,
  });
}

/** 记录一次非随机搜索（去重置顶；后端负责 trim 与空白忽略） */
export function addWallpaperHistory(
  source: string,
  keyword: string,
): Promise<void> {
  return invoke<void>("add_wallpaper_history", { source, keyword });
}

/** 删除单条搜索历史（不存在则静默成功） */
export function deleteWallpaperHistory(
  source: string,
  keyword: string,
): Promise<void> {
  return invoke<void>("delete_wallpaper_history", { source, keyword });
}

/** 清空某图源的全部搜索历史 */
export function clearWallpaperHistory(source: string): Promise<void> {
  return invoke<void>("clear_wallpaper_history", { source });
}
