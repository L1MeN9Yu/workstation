import { invoke } from "@tauri-apps/api/core";
import type { GhostyRemoteKey } from "./ghostyKeys";

export const GHOSTY_REMOTE_CACHE_KEY = "ghosty-remote-keys";

export function fetchRemoteGhostyKeys(): Promise<GhostyRemoteKey[]> {
  return invoke("fetch_ghosty_keys");
}

export function readRemoteCache(): GhostyRemoteKey[] | null {
  try {
    const raw = localStorage.getItem(GHOSTY_REMOTE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as GhostyRemoteKey[];
  } catch {
    return null;
  }
}

export function writeRemoteCache(keys: GhostyRemoteKey[]): void {
  try {
    localStorage.setItem(GHOSTY_REMOTE_CACHE_KEY, JSON.stringify(keys));
  } catch {
    // 存储不可用（隐私模式/超限）时静默降级，不影响主流程
  }
}
