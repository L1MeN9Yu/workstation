import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIterm2Keys } from "./iterm2Keys";
import { ITERM2_KEYS } from "../lib/iterm2Keys";

vi.mock("../lib/iterm2KeysRemote", () => ({
  fetchRemoteIterm2Keys: vi.fn(),
  readRemoteCache: vi.fn(),
  writeRemoteCache: vi.fn(),
}));

import {
  fetchRemoteIterm2Keys,
  readRemoteCache,
  writeRemoteCache,
} from "../lib/iterm2KeysRemote";

describe("iterm2Keys store", () => {
  beforeEach(() => {
    vi.mocked(fetchRemoteIterm2Keys).mockReset();
    vi.mocked(readRemoteCache).mockReset();
    vi.mocked(writeRemoteCache).mockReset();
    useIterm2Keys.setState({ keys: [...ITERM2_KEYS], source: "base" });
  });

  it("starts with base keys and base source", () => {
    expect(useIterm2Keys.getState().keys).toEqual(ITERM2_KEYS);
    expect(useIterm2Keys.getState().source).toBe("base");
  });

  it("init loads cache first then refreshes to remote", async () => {
    const cached = [{ key: "cache-key", description: "cached", category: "c" }];
    const remote = [{ key: "remote-key", description: "fresh", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(cached);
    vi.mocked(fetchRemoteIterm2Keys).mockResolvedValue(remote);

    await useIterm2Keys.getState().init();

    expect(useIterm2Keys.getState().source).toBe("remote");
    const keys = useIterm2Keys.getState().keys;
    expect(keys.some((k) => k.key === "remote-key")).toBe(true);
    expect(writeRemoteCache).toHaveBeenCalledWith(remote);
  });

  it("init applies cached merge before remote refresh completes", async () => {
    const cached = [{ key: "cache-key", description: "cached", category: "c" }];
    const remote = [{ key: "remote-key", description: "fresh", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(cached);
    vi.mocked(fetchRemoteIterm2Keys).mockResolvedValue(remote);

    const pending = useIterm2Keys.getState().init();
    expect(useIterm2Keys.getState().source).toBe("cache");
    expect(useIterm2Keys.getState().keys.some((k) => k.key === "cache-key")).toBe(true);
    await pending;
  });

  it("init without cache goes straight to remote", async () => {
    const remote = [{ key: "remote-key", description: "fresh", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(null);
    vi.mocked(fetchRemoteIterm2Keys).mockResolvedValue(remote);

    await useIterm2Keys.getState().init();

    expect(useIterm2Keys.getState().source).toBe("remote");
    expect(useIterm2Keys.getState().keys.some((k) => k.key === "remote-key")).toBe(true);
  });

  it("init keeps base when remote fetch fails", async () => {
    vi.mocked(readRemoteCache).mockReturnValue(null);
    vi.mocked(fetchRemoteIterm2Keys).mockRejectedValue(new Error("network"));

    await useIterm2Keys.getState().init();

    expect(useIterm2Keys.getState().source).toBe("base");
    expect(useIterm2Keys.getState().keys).toEqual(ITERM2_KEYS);
    expect(writeRemoteCache).not.toHaveBeenCalled();
  });

  it("init keeps cache when remote fetch fails after cache load", async () => {
    const cached = [{ key: "cache-key", description: "cached", category: "c" }];
    vi.mocked(readRemoteCache).mockReturnValue(cached);
    vi.mocked(fetchRemoteIterm2Keys).mockRejectedValue(new Error("network"));

    await useIterm2Keys.getState().init();

    expect(useIterm2Keys.getState().source).toBe("cache");
    expect(useIterm2Keys.getState().keys.some((k) => k.key === "cache-key")).toBe(true);
  });
});
