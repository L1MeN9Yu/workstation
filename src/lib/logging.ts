import { invoke } from "@tauri-apps/api/core";

/** 查询当前会话日志文件的绝对路径（如 `<app_log_dir>/workstation.log`）。 */
export function currentLogFile(): Promise<string> {
  return invoke<string>("current_log_file");
}