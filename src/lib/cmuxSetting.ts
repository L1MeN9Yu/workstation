import { invoke } from "@tauri-apps/api/core";

export interface DetectCmuxResult {
  configuredPath: string | null;
  resolvedPath: string | null;
  available: boolean;
  version: string | null;
  error: string | null;
}

/** 读取 cmux 命令路径配置；null/空串表示未配置（自动查找）。 */
export function readCmuxSetting(): Promise<string | null> {
  return invoke<string | null>("read_cmux_setting");
}

/** 保存 cmux 命令路径；留空表示自动查找。 */
export function writeCmuxSetting(binPath: string): Promise<void> {
  return invoke<void>("write_cmux_setting", { binPath });
}

/** 检测 cmux 命令：解析实际路径并验证可用性。 */
export function detectCmux(): Promise<DetectCmuxResult> {
  return invoke<DetectCmuxResult>("detect_cmux");
}
