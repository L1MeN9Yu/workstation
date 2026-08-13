import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRemoteGhostyKeys,
  GHOSTY_REMOTE_CACHE_KEY,
  readRemoteCache,
  writeRemoteCache,
} from "./ghostyKeysRemote";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

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

describe("ghostyKeysRemote", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("fetches remote keys via invoke", async () => {
    const remote = [{ key: "font-size", description: "d", category: "c" }];
    vi.mocked(invoke).mockResolvedValue(remote);
    await expect(fetchRemoteGhostyKeys()).resolves.toEqual(remote);
    expect(invoke).toHaveBeenCalledWith("fetch_ghosty_keys");
  });

  it("returns null when cache is empty", () => {
    expect(readRemoteCache()).toBeNull();
  });

  it("reads valid cache", () => {
    const remote = [{ key: "a", description: "x", category: "y" }];
    localStorage.setItem(GHOSTY_REMOTE_CACHE_KEY, JSON.stringify(remote));
    expect(readRemoteCache()).toEqual(remote);
  });

  it("returns null for invalid json in cache", () => {
    localStorage.setItem(GHOSTY_REMOTE_CACHE_KEY, "not-json{");
    expect(readRemoteCache()).toBeNull();
  });

  it("returns null when cache is not an array", () => {
    localStorage.setItem(GHOSTY_REMOTE_CACHE_KEY, JSON.stringify({ a: 1 }));
    expect(readRemoteCache()).toBeNull();
  });

  it("writes cache and reads back", () => {
    const remote = [{ key: "a", description: "x", category: "y" }];
    writeRemoteCache(remote);
    expect(readRemoteCache()).toEqual(remote);
  });

  it("silently ignores localStorage write failures", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    writeRemoteCache([{ key: "a", description: "x", category: "y" }]);
    spy.mockRestore();
    expect(readRemoteCache()).toBeNull();
  });

  it("silently ignores localStorage read failures", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readRemoteCache()).toBeNull();
    spy.mockRestore();
  });
});
