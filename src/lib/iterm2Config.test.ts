import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  deleteIterm2Profile,
  listIterm2Profiles,
  reloadIterm2Config,
  reloadStatusMessage,
  writeIterm2Profile,
  type Iterm2ProfileFile,
} from "./iterm2Config";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("iterm2Config", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("listIterm2Profiles invokes list_iterm2_profiles", async () => {
    const files: Iterm2ProfileFile[] = [
      {
        name: "default.json",
        path: "/home/user/Library/Application Support/iTerm2/DynamicProfiles/default.json",
        content: '{"Name":"Default"}',
      },
    ];
    vi.mocked(invoke).mockResolvedValue(files);
    const result = await listIterm2Profiles();
    expect(invoke).toHaveBeenCalledWith("list_iterm2_profiles");
    expect(result).toEqual(files);
  });

  it("listIterm2Profiles propagates rejection from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("read failed"));
    await expect(listIterm2Profiles()).rejects.toThrow("read failed");
  });

  it("writeIterm2Profile invokes write_iterm2_profile with name and content", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeIterm2Profile("my-profile.json", '{"Name":"My Profile"}');
    expect(invoke).toHaveBeenCalledWith("write_iterm2_profile", {
      name: "my-profile.json",
      content: '{"Name":"My Profile"}',
    });
  });

  it("writeIterm2Profile propagates rejection from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("write failed"));
    await expect(writeIterm2Profile("a.json", "{}")).rejects.toThrow("write failed");
  });

  it("deleteIterm2Profile invokes delete_iterm2_profile with name", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await deleteIterm2Profile("my-profile.json");
    expect(invoke).toHaveBeenCalledWith("delete_iterm2_profile", {
      name: "my-profile.json",
    });
  });

  it("deleteIterm2Profile propagates rejection from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("delete failed"));
    await expect(deleteIterm2Profile("a.json")).rejects.toThrow("delete failed");
  });

  it("reloadIterm2Config invokes reload_iterm2_config and returns status", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: "success" });
    const result = await reloadIterm2Config();
    expect(invoke).toHaveBeenCalledWith("reload_iterm2_config");
    expect(result).toEqual({ status: "success" });
  });

  it("reloadStatusMessage maps success", () => {
    expect(reloadStatusMessage({ status: "success" })).toBe("iTerm2 已重新加载配置");
  });

  it("reloadStatusMessage maps notRunning", () => {
    expect(reloadStatusMessage({ status: "notRunning" })).toContain("未运行");
  });

  it("reloadStatusMessage maps mechanismUnavailable", () => {
    expect(reloadStatusMessage({ status: "mechanismUnavailable" })).toContain("刷新机制不可用");
  });

  it("reloadStatusMessage maps failed with message", () => {
    const msg = reloadStatusMessage({ status: "failed", message: "boom" });
    expect(msg).toContain("boom");
  });

  it("reloadStatusMessage maps failed without message", () => {
    expect(reloadStatusMessage({ status: "failed" })).toContain("未知错误");
  });
});
