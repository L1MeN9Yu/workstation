import { readConfig, writeConfig } from "./configStore";

export const DEFAULT_PROXY = "";

const PROXY_KEY = "proxy";
const WALLPAPER_KEY = "wallpaper";

export function isValidProxyUrl(url: string): boolean {
  if (url.trim() === "") {
    return true;
  }
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 读取全局代理配置（`proxy.json` 的 `proxy` 字段，空串表示未配置）。
 * 首次调用时若全局未配置且旧壁纸配置存在非空代理，则一次性迁移：
 * 写入全局配置并清除壁纸配置中的 proxy 字段。
 * 非 Tauri 环境（invoke 失败）返回空串。
 */
export async function getGlobalProxy(): Promise<string> {
  let current: string;
  try {
    const stored = await readConfig<{ proxy?: string }>(PROXY_KEY);
    current = stored?.proxy ?? "";
  } catch {
    return "";
  }
  if (current.trim() !== "") {
    return current;
  }
  try {
    const wp = await readConfig<Record<string, unknown> & { proxy?: string }>(
      WALLPAPER_KEY,
    );
    const legacy = wp?.proxy ?? "";
    if (legacy.trim() !== "") {
      await writeConfig(PROXY_KEY, { proxy: legacy });
      const rest = { ...wp };
      delete rest.proxy;
      await writeConfig(WALLPAPER_KEY, rest);
      return legacy;
    }
  } catch {
    // 壁纸配置读取失败不影响全局代理读取
  }
  return "";
}

/** 保存全局代理配置；留空表示直连。URL 格式非法时抛错。 */
export async function saveGlobalProxy(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!isValidProxyUrl(trimmed)) {
    throw new Error(
      "代理地址无效，应为 http:// 或 https:// 开头的 URL（留空表示直连）",
    );
  }
  await writeConfig(PROXY_KEY, { proxy: trimmed });
}
