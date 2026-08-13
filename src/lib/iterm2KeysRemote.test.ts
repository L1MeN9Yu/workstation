import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRemoteIterm2Keys,
  ITERM2_REMOTE_CACHE_KEY,
  readRemoteCache,
  writeRemoteCache,
} from "./iterm2KeysRemote";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// node 26 实验性 global localStorage 与 jsdom 冲突；显式 polyfill window.localStorage。
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(window, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

describe("iterm2KeysRemote", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("fetches remote keys via invoke", async () => {
    const keys = [{ key: "Name", description: "d", category: "c" }];
    vi.mocked(invoke).mockResolvedValue(keys);
    await expect(fetchRemoteIterm2Keys()).resolves.toEqual(keys);
    expect(invoke).toHaveBeenCalledWith("fetch_iterm2_keys");
  });

  it("reads cached keys from localStorage", () => {
    const keys = [{ key: "Name", description: "d", category: "c" }];
    localStorage.setItem(ITERM2_REMOTE_CACHE_KEY, JSON.stringify(keys));
    expect(readRemoteCache()).toEqual(keys);
  });

  it("returns null when cache is empty or invalid", () => {
    expect(readRemoteCache()).toBeNull();
    localStorage.setItem(ITERM2_REMOTE_CACHE_KEY, "{not json");
    expect(readRemoteCache()).toBeNull();
    localStorage.setItem(ITERM2_REMOTE_CACHE_KEY, JSON.stringify({ key: 1 }));
    expect(readRemoteCache()).toBeNull();
  });

  it("writes cache to localStorage", () => {
    const keys = [{ key: "Name", description: "d", category: "c" }];
    writeRemoteCache(keys);
    expect(JSON.parse(localStorage.getItem(ITERM2_REMOTE_CACHE_KEY) ?? "null")).toEqual(keys);
  });

  it("silently ignores localStorage write errors", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    writeRemoteCache([{ key: "Name", description: "d", category: "c" }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
