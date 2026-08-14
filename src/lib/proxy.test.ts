import { describe, expect, it, vi, beforeEach } from "vitest";
import { getGlobalProxy, isValidProxyUrl, saveGlobalProxy } from "./proxy";
import { readConfig, writeConfig } from "./configStore";

vi.mock("./configStore", () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}));

const mockedRead = vi.mocked(readConfig);
const mockedWrite = vi.mocked(writeConfig);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isValidProxyUrl", () => {
  it("accepts empty string as valid (direct connection)", () => {
    expect(isValidProxyUrl("")).toBe(true);
    expect(isValidProxyUrl("   ")).toBe(true);
  });

  it("accepts http/https urls", () => {
    expect(isValidProxyUrl("http://127.0.0.1:7890")).toBe(true);
    expect(isValidProxyUrl("https://proxy.example.com:8080")).toBe(true);
  });

  it("rejects invalid urls", () => {
    expect(isValidProxyUrl("not a url")).toBe(false);
    expect(isValidProxyUrl("ftp://host")).toBe(false);
    expect(isValidProxyUrl("http://")).toBe(false);
  });
});

describe("getGlobalProxy", () => {
  it("returns empty string when config missing", async () => {
    mockedRead.mockResolvedValue(null);
    expect(await getGlobalProxy()).toBe("");
    expect(mockedRead).toHaveBeenCalledWith("proxy");
  });

  it("returns configured global proxy directly", async () => {
    mockedRead.mockResolvedValue({ proxy: "http://127.0.0.1:7890" });
    expect(await getGlobalProxy()).toBe("http://127.0.0.1:7890");
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("migrates non-default wallpaper proxy and clears wallpaper field", async () => {
    mockedRead
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ proxy: "http://192.168.1.1:8080", downloadDir: "/tmp" });
    expect(await getGlobalProxy()).toBe("http://192.168.1.1:8080");
    expect(mockedWrite).toHaveBeenCalledWith("proxy", {
      proxy: "http://192.168.1.1:8080",
    });
    expect(mockedWrite).toHaveBeenCalledWith("wallpaper", { downloadDir: "/tmp" });
  });

  it("does not migrate default wallpaper proxy", async () => {
    mockedRead
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ proxy: "http://127.0.0.1:7890" });
    expect(await getGlobalProxy()).toBe("");
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("does not migrate empty wallpaper proxy", async () => {
    mockedRead.mockResolvedValueOnce(null).mockResolvedValueOnce({ proxy: "" });
    expect(await getGlobalProxy()).toBe("");
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("returns empty string when invoke fails (browser env)", async () => {
    mockedRead.mockRejectedValue(new Error("invoke failed"));
    expect(await getGlobalProxy()).toBe("");
  });
});

describe("saveGlobalProxy", () => {
  it("saves trimmed url", async () => {
    await saveGlobalProxy("  http://127.0.0.1:7890  ");
    expect(mockedWrite).toHaveBeenCalledWith("proxy", {
      proxy: "http://127.0.0.1:7890",
    });
  });

  it("saves empty string to disable proxy", async () => {
    await saveGlobalProxy("");
    expect(mockedWrite).toHaveBeenCalledWith("proxy", { proxy: "" });
  });

  it("rejects invalid url", async () => {
    await expect(saveGlobalProxy("nope")).rejects.toThrow("代理地址无效");
    expect(mockedWrite).not.toHaveBeenCalled();
  });
});
