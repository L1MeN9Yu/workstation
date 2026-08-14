declare global {
  interface Window {
    // Tauri 2 运行时总是注入的 IPC 内部对象（与 withGlobalTauri 无关）
    __TAURI_INTERNALS__?: unknown;
  }
}

export {};
