import { invoke } from "@tauri-apps/api/core";

export interface Iterm2ProfileFile {
  name: string;
  path: string;
  content: string;
}

export interface Iterm2ReloadResult {
  status: "success" | "notRunning" | "mechanismUnavailable" | "failed";
  message?: string;
}

export function listIterm2Profiles(): Promise<Iterm2ProfileFile[]> {
  return invoke("list_iterm2_profiles");
}

export function writeIterm2Profile(name: string, content: string): Promise<void> {
  return invoke("write_iterm2_profile", { name, content });
}

export function deleteIterm2Profile(name: string): Promise<void> {
  return invoke("delete_iterm2_profile", { name });
}

export function reloadIterm2Config(): Promise<Iterm2ReloadResult> {
  return invoke("reload_iterm2_config");
}

export function reloadStatusMessage(result: Iterm2ReloadResult): string {
  switch (result.status) {
    case "success":
      return "iTerm2 已重新加载配置";
    case "notRunning":
      return "iTerm2 未运行，无法重载，请先启动 iTerm2";
    case "mechanismUnavailable":
      return "iTerm2 刷新机制不可用，配置已保存，重启 iTerm2 后生效";
    case "failed":
      return `配置重载失败：${result.message ?? "未知错误"}`;
  }
}
