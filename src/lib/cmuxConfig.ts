import { invoke } from "@tauri-apps/api/core";

export interface CmuxConfigFile {
  kind: "cmux" | "ghosty";
  path: string;
  content: string;
}

export function readCmuxConfig(): Promise<CmuxConfigFile> {
  return invoke("read_cmux_config");
}

export function readGhostyConfig(): Promise<CmuxConfigFile> {
  return invoke("read_ghosty_config");
}

export function writeCmuxConfig(content: string): Promise<void> {
  return invoke("write_cmux_config", { content });
}

export function writeGhostyConfig(content: string): Promise<void> {
  return invoke("write_ghosty_config", { content });
}

export interface CmuxReloadResult {
  status: "success" | "notRunning" | "cliMissing" | "failed";
  message?: string;
}

export function reloadCmuxConfig(): Promise<CmuxReloadResult> {
  return invoke("reload_cmux_config");
}

export function reloadStatusMessage(result: CmuxReloadResult): string {
  switch (result.status) {
    case "success":
      return "配置已重新加载，cmux 已生效";
    case "notRunning":
      return "cmux 未运行，无法重载配置，请先启动 cmux";
    case "cliMissing":
      return "未找到 cmux 命令，请检查安装与 PATH";
    case "failed":
      return `配置重载失败：${result.message ?? "未知错误"}`;
  }
}
