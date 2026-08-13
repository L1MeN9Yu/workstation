import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSystemFonts } from "./systemFonts";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("systemFonts", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("listSystemFonts invokes list_system_fonts and returns fonts", async () => {
    const fonts = ["Menlo", "JetBrains Mono", "PingFang SC"];
    vi.mocked(invoke).mockResolvedValue(fonts);
    const result = await listSystemFonts();
    expect(invoke).toHaveBeenCalledWith("list_system_fonts");
    expect(result).toEqual(fonts);
  });

  it("propagates rejection from invoke", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("tauri unavailable"));
    await expect(listSystemFonts()).rejects.toThrow("tauri unavailable");
  });
});
