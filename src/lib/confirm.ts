import { ask } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./updater";

/**
 * 统一的确认对话框：Tauri 环境走原生系统对话框（macOS WKWebView
 * 不支持 window.confirm，必须用原生对话框），非 Tauri 环境降级为
 * window.confirm，ask 调用异常时视为取消（返回 false）。
 */
export function confirmDialog(message: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return Promise.resolve(window.confirm(message));
  }
  return ask(message, {
    title: "确认",
    kind: "warning",
  }).catch(() => false);
}
