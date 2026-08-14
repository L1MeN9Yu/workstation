import { emit } from "@tauri-apps/api/event";

export type FrontendLogLevel = "debug" | "info" | "warn" | "error";

export interface FrontendLogPayload {
  level: FrontendLogLevel;
  message: string;
  source: "frontend";
  timestamp: string;
}

export const FRONTEND_LOG_EVENT = "frontend-log";
const FLUSH_INTERVAL_MS = 200;
const FLUSH_BATCH_SIZE = 20;

let buffer: FrontendLogPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hookInstalled = false;

export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? String(a);
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
}

function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  emit(FRONTEND_LOG_EVENT, batch).catch(() => {
    // 转发失败不影响前端功能
  });
}

function queue(level: FrontendLogLevel, message: string): void {
  buffer.push({
    level,
    message,
    source: "frontend",
    timestamp: new Date().toISOString(),
  });
  if (buffer.length >= FLUSH_BATCH_SIZE) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * 挂载前端日志转发：代理 console 并监听全局错误。
 * 仅 Tauri 环境生效；非 Tauri 环境（浏览器/测试）为 no-op。
 * `includeDebug` 开启时额外转发 info/debug 级别（建议开发模式开启）。
 */
export function initFrontendLogging(options: { includeDebug?: boolean } = {}): boolean {
  if (!isTauriEnv() || hookInstalled) return false;
  hookInstalled = true;
  const includeDebug = options.includeDebug ?? false;

  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    queue("warn", formatArgs(args));
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    queue("error", formatArgs(args));
  };
  if (includeDebug) {
    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      queue("info", formatArgs(args));
    };
    console.debug = (...args: unknown[]) => {
      originalDebug(...args);
      queue("debug", formatArgs(args));
    };
  }

  window.addEventListener("error", (event) => {
    queue("error", event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    queue("error", formatArgs([event.reason]));
  });
  return true;
}

/** 立即将缓冲区内的日志发出（测试与退出前兜底用）。 */
export function flushFrontendLogs(): void {
  flush();
}
