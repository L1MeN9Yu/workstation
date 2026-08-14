import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CONSOLE = {
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

function mockEventModule(): { emitMock: ReturnType<typeof vi.fn> } {
  const emitMock = vi.fn(async () => undefined);
  vi.doMock("@tauri-apps/api/event", () => ({ emit: emitMock }));
  return { emitMock };
}

async function loadFrontendLog() {
  return await import("./frontendLog");
}

describe("frontendLog", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    console.warn = ORIGINAL_CONSOLE.warn;
    console.error = ORIGINAL_CONSOLE.error;
    console.info = ORIGINAL_CONSOLE.info;
    console.debug = ORIGINAL_CONSOLE.debug;
    vi.useRealTimers();
  });

  it("is no-op outside Tauri: init returns false and console is not proxied", async () => {
    const mod = await loadFrontendLog();

    expect(mod.isTauriEnv()).toBe(false);
    expect(mod.initFrontendLogging()).toBe(false);

    const spy = vi.spyOn(console, "error");
    console.error("should not be forwarded");
    expect(spy).toHaveBeenCalledWith("should not be forwarded");
    expect(console.error).toBe(spy);
  });

  it("proxies console.error and emits batched payload", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();

    expect(mod.initFrontendLogging()).toBe(true);
    const errorSpy = vi.spyOn(console, "error");
    console.error("boom", { code: 1 });
    errorSpy.mockRestore();

    expect(mod.flushFrontendLogs());
    expect(emitMock).toHaveBeenCalledTimes(1);
    const batch = emitMock.mock.calls[0]?.[1] as Array<{
      level: string;
      message: string;
      source: string;
      timestamp: string;
    }>;
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({
      level: "error",
      message: 'boom {"code":1}',
      source: "frontend",
    });
    expect(typeof batch[0].timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(batch[0].timestamp))).toBe(false);
  });

  it("still calls the original console method when proxied", async () => {
    mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    const errorSpy = vi.spyOn(console, "error");
    console.error("original still runs");
    expect(errorSpy).toHaveBeenCalledWith("original still runs");
    errorSpy.mockRestore();
  });

  it("formats Error objects with stack and multiple args", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    const err = new Error("kaboom");
    console.error(err, "context");

    mod.flushFrontendLogs();
    const batch = emitMock.mock.calls[0]?.[1] as Array<{ message: string }>;
    expect(batch[0].message).toContain("kaboom");
    expect(batch[0].message).toContain("context");
  });

  it("falls back to String() when JSON.stringify throws on circular objects", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    console.error("circular", circular);

    mod.flushFrontendLogs();
    const batch = emitMock.mock.calls[0]?.[1] as Array<{ message: string }>;
    expect(batch[0].message).toBe("circular [object Object]");
  });

  it("falls back to String() when Error has no stack", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    const err = new Error("no stack");
    Object.defineProperty(err, "stack", { value: undefined });
    console.error(err);

    mod.flushFrontendLogs();
    const batch = emitMock.mock.calls[0]?.[1] as Array<{ message: string }>;
    expect(batch[0].message).toBe("Error: no stack");
  });

  it("swallows emit failures", async () => {
    const emitMock = vi.fn(async () => {
      throw new Error("emit failed");
    });
    vi.doMock("@tauri-apps/api/event", () => ({ emit: emitMock }));
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    console.error("will fail to emit");
    await expect(mod.flushFrontendLogs()).toBeUndefined();
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("flushes immediately when batch reaches 20 entries", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    for (let i = 0; i < 20; i++) {
      console.warn(`w${i}`);
    }

    expect(emitMock).toHaveBeenCalledTimes(1);
    const batch = emitMock.mock.calls[0]?.[1] as unknown[];
    expect(batch).toHaveLength(20);
  });

  it("flushes after the debounce interval via timer", async () => {
    vi.useFakeTimers();
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    console.error("late log");
    expect(emitMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const batch = emitMock.mock.calls[0]?.[1] as unknown[];
    expect(batch).toHaveLength(1);
  });

  it("captures window error events as error level", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    window.dispatchEvent(new ErrorEvent("error", { message: "window error" }));
    mod.flushFrontendLogs();
    const batch = emitMock.mock.calls[0]?.[1] as Array<{ level: string; message: string }>;
    expect(batch[0]).toMatchObject({ level: "error", message: "window error" });
  });

  it("captures unhandledrejection reasons", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    const evt = new Event("unhandledrejection");
    Object.defineProperty(evt, "reason", { value: new Error("rejected") });
    window.dispatchEvent(evt);
    mod.flushFrontendLogs();
    const batch = emitMock.mock.calls[0]?.[1] as Array<{ level: string; message: string }>;
    expect(batch[0].level).toBe("error");
    expect(batch[0].message).toContain("rejected");
  });

  it("does not forward info/debug by default", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging();

    console.info("hidden info");
    mod.flushFrontendLogs();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("forwards info/debug when includeDebug is enabled", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();
    mod.initFrontendLogging({ includeDebug: true });

    console.info("visible info");
    console.debug("visible debug");
    mod.flushFrontendLogs();

    const batch = emitMock.mock.calls[0]?.[1] as Array<{ level: string; message: string }>;
    expect(batch.map((b) => b.level)).toEqual(["info", "debug"]);
  });

  it("init is idempotent and does not double-proxy", async () => {
    const { emitMock } = mockEventModule();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const mod = await loadFrontendLog();

    expect(mod.initFrontendLogging()).toBe(true);
    expect(mod.initFrontendLogging()).toBe(false);

    console.error("single");
    mod.flushFrontendLogs();
    const batch = emitMock.mock.calls[0]?.[1] as unknown[];
    expect(batch).toHaveLength(1);
  });
});
