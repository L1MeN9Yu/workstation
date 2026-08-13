import { invoke } from "@tauri-apps/api/core";
import type { Iterm2RemoteKey } from "./iterm2Keys";

export const ITERM2_REMOTE_CACHE_KEY = "iterm2-remote-keys";

export function fetchRemoteIterm2Keys(): Promise<Iterm2RemoteKey[]> {
  return invoke("fetch_iterm2_keys");
}

export function readRemoteCache(): Iterm2RemoteKey[] | null {
  try {
    const raw = localStorage.getItem(ITERM2_REMOTE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as Iterm2RemoteKey[];
  } catch {
    return null;
  }
}

export function writeRemoteCache(keys: Iterm2RemoteKey[]): void {
  try {
    localStorage.setItem(ITERM2_REMOTE_CACHE_KEY, JSON.stringify(keys));
  } catch {
    // 存储不可用（隐私模式/超限）时静默降级，不影响主流程
  }
}
