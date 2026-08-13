import { describe, expect, it } from "vitest";
import {
  filterGhostyKeys,
  findGhostyKey,
  GHOSTY_KEYS,
  mergeGhostyKeys,
  validateGhostyValue,
  type GhostyKeySpec,
} from "./ghostyKeys";

describe("ghostyKeys", () => {
  it("finds a known key", () => {
    expect(findGhostyKey("font-size")?.type).toBe("number");
    expect(findGhostyKey("background")?.type).toBe("color");
  });

  it("returns undefined for unknown key", () => {
    expect(findGhostyKey("not-a-real-key")).toBeUndefined();
  });

  it("filters by query with empty query returning full list", () => {
    expect(filterGhostyKeys("")).toHaveLength(GHOSTY_KEYS.length);
    expect(filterGhostyKeys("  ")).toHaveLength(GHOSTY_KEYS.length);
  });

  it("filters by key name", () => {
    const out = filterGhostyKeys("font-size");
    expect(out.every((k) => k.key.includes("font-size"))).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("filters by description text only", () => {
    const out = filterGhostyKeys("clamped");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((k) => !k.key.includes("clamped"))).toBe(true);
  });

  it("returns empty for unmatched query", () => {
    expect(filterGhostyKeys("zzz-no-such-key")).toEqual([]);
  });

  it("validates enum values", () => {
    const spec = findGhostyKey("cursor-style")!;
    expect(validateGhostyValue(spec, "block")).toBeNull();
    expect(validateGhostyValue(spec, "block_hollow")).toBeNull();
    expect(validateGhostyValue(spec, "nope")).toContain("值必须是以下之一");
  });

  it("rejects enum value when spec lacks enum list", () => {
    const spec: GhostyKeySpec = {
      key: "x",
      type: "enum",
      description: "",
      category: "",
    };
    expect(validateGhostyValue(spec, "v")).toBe("值必须是以下之一：");
  });

  it("validates bool values", () => {
    const spec = findGhostyKey("mouse-reporting")!;
    expect(validateGhostyValue(spec, "true")).toBeNull();
    expect(validateGhostyValue(spec, "false")).toBeNull();
    expect(validateGhostyValue(spec, "yes")).toBe("值必须是 true 或 false");
  });

  it("validates number values with min/max", () => {
    const spec = findGhostyKey("cursor-opacity")!;
    expect(validateGhostyValue(spec, "0.5")).toBeNull();
    expect(validateGhostyValue(spec, "-1")).toContain("不能小于");
    expect(validateGhostyValue(spec, "2")).toContain("不能大于");
    expect(validateGhostyValue(spec, "abc")).toBe("值必须是数字");
  });

  it("passes text values without validation", () => {
    const spec = findGhostyKey("title")!;
    expect(validateGhostyValue(spec, "anything")).toBeNull();
  });

  it("maintains data integrity: unique keys, enum has values, min <= max", () => {
    const keys = GHOSTY_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of GHOSTY_KEYS) {
      if (k.type === "enum") {
        expect(k.enum && k.enum.length > 0).toBe(true);
      }
      if (k.min !== undefined && k.max !== undefined) {
        expect(k.min).toBeLessThanOrEqual(k.max);
      }
    }
  });

  it("covers the official ghostty key set size", () => {
    expect(GHOSTY_KEYS.length).toBe(202);
  });
});
  it("finds by custom keys list", () => {
    const custom: GhostyKeySpec[] = [
      { key: "new-key", type: "bool", description: "", category: "" },
    ];
    expect(findGhostyKey("new-key", custom)).toBe(custom[0]);
    expect(findGhostyKey("font-size", custom)).toBeUndefined();
  });

  it("filters by custom keys list", () => {
    const custom: GhostyKeySpec[] = [
      { key: "alpha", type: "text", description: "first", category: "" },
      { key: "beta", type: "text", description: "second", category: "" },
    ];
    expect(filterGhostyKeys("alpha", custom)).toEqual([custom[0]]);
    expect(filterGhostyKeys("", custom)).toHaveLength(2);
    expect(filterGhostyKeys("none", custom)).toEqual([]);
  });

  it("merges remote keys keeping local annotations", () => {
    const base: GhostyKeySpec[] = [
      {
        key: "font-size",
        type: "number",
        min: 1,
        description: "local desc",
        category: "字体与渲染",
      },
    ];
    const remote = [
      { key: "font-size", description: "remote desc", category: "字体与渲染" },
      { key: "brand-new-key", description: "new option", category: "其他" },
    ];
    const merged = mergeGhostyKeys(remote, base);
    expect(merged).toHaveLength(2);
    const fs = merged.find((k) => k.key === "font-size")!;
    expect(fs.type).toBe("number");
    expect(fs.min).toBe(1);
    expect(fs.description).toBe("local desc");
    const fresh = merged.find((k) => k.key === "brand-new-key")!;
    expect(fresh.type).toBe("text");
    expect(fresh.description).toBe("new option");
    expect(fresh.category).toBe("其他");
  });

  it("merges keeps local-only keys and sorts by key name", () => {
    const base: GhostyKeySpec[] = [
      { key: "zz-local", type: "text", description: "local", category: "" },
      { key: "aa-local", type: "bool", description: "local2", category: "" },
    ];
    const merged = mergeGhostyKeys(
      [{ key: "mm-remote", description: "r", category: "" }],
      base,
    );
    expect(merged.map((k) => k.key)).toEqual(["aa-local", "mm-remote", "zz-local"]);
    expect(merged.find((k) => k.key === "zz-local")?.type).toBe("text");
  });

  it("merges with default base list", () => {
    const remote = [{ key: "font-size", description: "d", category: "c" }];
    const merged = mergeGhostyKeys(remote);
    expect(merged.find((k) => k.key === "font-size")?.type).toBe("number");
  });

