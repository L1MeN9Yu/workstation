import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  readCmuxSetting,
  writeCmuxSetting,
  detectCmux,
} from "./cmuxSetting";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readCmuxSetting", () => {
  it("invokes read_cmux_setting and returns the path", async () => {
    mockedInvoke.mockResolvedValue("/opt/homebrew/bin/cmux");
    await expect(readCmuxSetting()).resolves.toBe("/opt/homebrew/bin/cmux");
    expect(mockedInvoke).toHaveBeenCalledWith("read_cmux_setting");
  });

  it("returns null when unconfigured", async () => {
    mockedInvoke.mockResolvedValue(null);
    await expect(readCmuxSetting()).resolves.toBeNull();
  });
});

describe("writeCmuxSetting", () => {
  it("invokes write_cmux_setting with the path", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await writeCmuxSetting("/custom/cmux");
    expect(mockedInvoke).toHaveBeenCalledWith("write_cmux_setting", {
      binPath: "/custom/cmux",
    });
  });
});

describe("detectCmux", () => {
  it("invokes detect_cmux and returns the result", async () => {
    const result = {
      configuredPath: null,
      resolvedPath: "/opt/homebrew/bin/cmux",
      available: true,
      version: "cmux 1.2.3",
      error: null,
    };
    mockedInvoke.mockResolvedValue(result);
    await expect(detectCmux()).resolves.toEqual(result);
    expect(mockedInvoke).toHaveBeenCalledWith("detect_cmux");
  });
});
