import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGhostyKeys } from "./ghostyKeys";
import { GHOSTY_KEYS } from "../lib/ghostyKeys";

vi.mock("../lib/ghostyKeysRemote", () => ({
  fetchRemoteGhostyKeys: vi.fn(),
  readRemoteCache: vi.fn(),
  writeRemoteCache: vi.fn(),
}));

import {
  fetchRemoteGhostyKeys,
  readRemoteCache,
  writeRemoteCache,
} from "../lib/ghostyKeysRemote";

describe("ghostyKeys store", () => {
  beforeEach(() => {
    vi.mocked(fetchRemoteGhostyKeys).mockReset();
    vi.mocked(readRemoteCache).mockReset();
    vi.mocked(writeRemoteCache).mockReset();
    useGhostyKeys.setState({ keys: [...GHOSTY_KEYS], source: "base" });
  });

  it("starts with base keys and base source", () => {
    expect(useGhostyKeys.getState().keys).toEqual(GHOSTY_KEYS);
    expect(useGhostyKeys.getState().source).toBe("base");
  });

  it("init loads cache first then refreshes to remote", async () => {
    const cached = [
      { key: "cache-key", description: "cached", category: "c" },
    ];
    const remote = [
      { key: "remote-key", description: "fresh", category: "c" },
    ];
    vi.mocked(readRemoteCache).mockReturnValue(cached);
    vi.mocked(fetchRemoteGhostyKeys).mockResolvedValue(remote);

    await useGhostyKeys.getState().init();

    expect(useGhostyKeys.getState().source).toBe("remote");
    const keys = useGhostyKeys.getState().keys;
    expect(keys.some((k) => k.key === "remote-key")).toBe(true);
    expect(writeRemoteCache).toHaveBeenCalledWith(remote);
  });

  it("init applies cached merge before remote refresh completes", async () => {
    const cached = [{ key: "cache-key", description: "cached", category: "c" }];
    const remote = [{ key: "remote-key", description: "fresh", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(cached);
    vi.mocked(fetchRemoteGhostyKeys).mockResolvedValue(remote);

    const pending = useGhostyKeys.getState().init();
    expect(useGhostyKeys.getState().source).toBe("cache");
    expect(useGhostyKeys.getState().keys.some((k) => k.key === "cache-key")).toBe(true);
    await pending;
  });

  it("init without cache goes straight to remote", async () => {
    const remote = [{ key: "remote-key", description: "fresh", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(null);
    vi.mocked(fetchRemoteGhostyKeys).mockResolvedValue(remote);

    await useGhostyKeys.getState().init();

    expect(useGhostyKeys.getState().source).toBe("remote");
    expect(useGhostyKeys.getState().keys.some((k) => k.key === "remote-key")).toBe(true);
  });

  it("init keeps base when remote fetch fails", async () => {
    vi.mocked(readRemoteCache).mockReturnValue(null);
    vi.mocked(fetchRemoteGhostyKeys).mockRejectedValue(new Error("network"));

    await useGhostyKeys.getState().init();

    expect(useGhostyKeys.getState().source).toBe("base");
    expect(useGhostyKeys.getState().keys).toEqual(GHOSTY_KEYS);
    expect(writeRemoteCache).not.toHaveBeenCalled();
  });

  it("init keeps cache when remote fetch fails after cache load", async () => {
    const cached = [{ key: "cache-key", description: "cached", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(cached);
    vi.mocked(fetchRemoteGhostyKeys).mockRejectedValue(new Error("network"));

    await useGhostyKeys.getState().init();

    expect(useGhostyKeys.getState().source).toBe("cache");
    expect(useGhostyKeys.getState().keys.some((k) => k.key === "cache-key")).toBe(true);
  });
});
