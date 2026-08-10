import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  readCmuxConfig,
  readGhostyConfig,
  type CmuxConfigFile,
} from "./cmuxConfig";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("cmuxConfig", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("readCmuxConfig invokes read_cmux_config", async () => {
    const file: CmuxConfigFile = {
      kind: "cmux",
      path: "/home/user/.config/cmux/cmux.json",
      content: "{}",
    };
    vi.mocked(invoke).mockResolvedValue(file);
    const result = await readCmuxConfig();
    expect(invoke).toHaveBeenCalledWith("read_cmux_config");
    expect(result).toEqual(file);
  });

  it("readGhostyConfig invokes read_ghosty_config", async () => {
    const file: CmuxConfigFile = {
      kind: "ghosty",
      path: "/home/user/Library/Application Support/com.cmuxterm.app/config.ghostty",
      content: "background-opacity = 0.75",
    };
    vi.mocked(invoke).mockResolvedValue(file);
    const result = await readGhostyConfig();
    expect(invoke).toHaveBeenCalledWith("read_ghosty_config");
    expect(result).toEqual(file);
  });

  it("propagates rejection from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("file not found"));
    await expect(readGhostyConfig()).rejects.toThrow("file not found");
  });
});
