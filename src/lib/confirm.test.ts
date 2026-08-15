import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDialog } from "./confirm";
import { isTauriRuntime } from "./updater";

vi.mock("./updater", () => ({
  isTauriRuntime: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
}));

import { ask } from "@tauri-apps/plugin-dialog";

const mockedAsk = vi.mocked(ask);
const mockedIsTauriRuntime = vi.mocked(isTauriRuntime);

describe("confirmDialog", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("uses native ask dialog in Tauri environment", async () => {
    mockedIsTauriRuntime.mockReturnValue(true);
    mockedAsk.mockResolvedValue(true);
    const result = await confirmDialog("确定继续？");
    expect(result).toBe(true);
    expect(ask).toHaveBeenCalledWith("确定继续？", {
      title: "确认",
      kind: "warning",
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("returns false when user cancels the native dialog", async () => {
    mockedIsTauriRuntime.mockReturnValue(true);
    mockedAsk.mockResolvedValue(false);
    const result = await confirmDialog("确定继续？");
    expect(result).toBe(false);
  });

  it("falls back to window.confirm outside Tauri environment", async () => {
    mockedIsTauriRuntime.mockReturnValue(false);
    confirmSpy.mockReturnValue(false);
    const result = await confirmDialog("确定继续？");
    expect(result).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith("确定继续？");
    expect(ask).not.toHaveBeenCalled();
  });

  it("treats ask failure as cancelled", async () => {
    mockedIsTauriRuntime.mockReturnValue(true);
    mockedAsk.mockRejectedValue(new Error("dialog unavailable"));
    const result = await confirmDialog("确定继续？");
    expect(result).toBe(false);
  });
});
