import { describe, expect, it, vi, beforeEach } from "vitest";
import { readConfig, writeConfig } from "./configStore";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("configStore", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("readConfig returns parsed value", async () => {
    vi.mocked(invoke).mockResolvedValue({ theme: "dark" });
    const result = await readConfig<{ theme: string }>("theme");
    expect(invoke).toHaveBeenCalledWith("read_config", { key: "theme" });
    expect(result).toEqual({ theme: "dark" });
  });

  it("readConfig returns null when invoke returns null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const result = await readConfig("missing");
    expect(result).toBeNull();
  });

  it("writeConfig passes key and value to invoke", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeConfig("theme", { theme: "light" });
    expect(invoke).toHaveBeenCalledWith("write_config", {
      key: "theme",
      value: { theme: "light" },
    });
  });
});
