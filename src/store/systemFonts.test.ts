import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemFonts } from "./systemFonts";
import { listSystemFonts } from "../lib/systemFonts";

vi.mock("../lib/systemFonts", () => ({
  listSystemFonts: vi.fn(),
}));

describe("systemFonts store", () => {
  beforeEach(() => {
    vi.mocked(listSystemFonts).mockReset();
    useSystemFonts.setState({ fonts: [], source: "base" });
  });

  it("starts with empty fonts and base source", () => {
    expect(useSystemFonts.getState().fonts).toEqual([]);
    expect(useSystemFonts.getState().source).toBe("base");
  });

  it("init loads fonts and marks source loaded", async () => {
    const fonts = ["Menlo", "JetBrains Mono"];
    vi.mocked(listSystemFonts).mockResolvedValue(fonts);

    await useSystemFonts.getState().init();

    expect(useSystemFonts.getState().fonts).toEqual(fonts);
    expect(useSystemFonts.getState().source).toBe("loaded");
  });

  it("init does not refetch once already loaded", async () => {
    vi.mocked(listSystemFonts).mockResolvedValue(["Menlo"]);
    await useSystemFonts.getState().init();
    vi.mocked(listSystemFonts).mockClear();

    await useSystemFonts.getState().init();

    expect(listSystemFonts).not.toHaveBeenCalled();
    expect(useSystemFonts.getState().fonts).toEqual(["Menlo"]);
  });

  it("refresh failure keeps state unchanged without throwing", async () => {
    vi.mocked(listSystemFonts).mockRejectedValue(new Error("tauri unavailable"));

    await expect(useSystemFonts.getState().refresh()).resolves.toBeUndefined();

    expect(useSystemFonts.getState().fonts).toEqual([]);
    expect(useSystemFonts.getState().source).toBe("base");
  });
});
