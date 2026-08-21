import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  readCmuxConfig,
  readGhostyConfig,
  reloadCmuxConfig,
  reloadStatusMessage,
  writeCmuxConfig,
  writeGhostyConfig,
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

  it("writeCmuxConfig invokes write_cmux_config with content", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeCmuxConfig('{"schemaVersion": 2}');
    expect(invoke).toHaveBeenCalledWith("write_cmux_config", {
      content: '{"schemaVersion": 2}',
    });
  });

  it("writeGhostyConfig invokes write_ghosty_config with content", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeGhostyConfig("background-opacity = 0.5");
    expect(invoke).toHaveBeenCalledWith("write_ghosty_config", {
      content: "background-opacity = 0.5",
    });
  });

  it("reloadCmuxConfig invokes reload_cmux_config and returns status", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: "success" });
    const result = await reloadCmuxConfig();
    expect(invoke).toHaveBeenCalledWith("reload_cmux_config");
    expect(result).toEqual({ status: "success" });
  });

  it("reloadStatusMessage maps success", () => {
    expect(reloadStatusMessage({ status: "success" })).toContain("已生效");
  });

  it("reloadStatusMessage maps notRunning", () => {
    expect(reloadStatusMessage({ status: "notRunning" })).toContain("未运行");
  });

  it("reloadStatusMessage maps cliMissing", () => {
    expect(reloadStatusMessage({ status: "cliMissing" })).toContain("未找到 cmux 命令");
  });

  it("reloadStatusMessage maps external access denial", () => {
    const msg = reloadStatusMessage({
      status: "accessDenied",
      message: "only processes started inside cmux can connect",
    });
    expect(msg).toContain("拒绝外部应用访问");
    expect(msg).toContain("only processes started inside cmux");
  });

  it("reloadStatusMessage gives access denial guidance without detail", () => {
    expect(reloadStatusMessage({ status: "accessDenied" })).toContain(
      "socketControlMode 设置为 automation",
    );
  });

  it("reloadStatusMessage maps connection failures with guidance", () => {
    const msg = reloadStatusMessage({
      status: "connectionFailed",
      message: "socket refused",
    });
    expect(msg).toContain("无法连接 cmux");
    expect(msg).toContain("socket refused");
  });

  it("reloadStatusMessage gives connection guidance without detail", () => {
    expect(reloadStatusMessage({ status: "connectionFailed" })).toContain(
      "socket 配置正确",
    );
  });

  it("reloadStatusMessage maps failed with message", () => {
    const msg = reloadStatusMessage({ status: "failed", message: "boom" });
    expect(msg).toContain("boom");
  });

  it("reloadStatusMessage maps failed without message", () => {
    expect(reloadStatusMessage({ status: "failed" })).toContain("未知错误");
  });
});
