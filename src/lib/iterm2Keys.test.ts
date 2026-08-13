import { describe, expect, it } from "vitest";
import {
  filterIterm2Keys,
  findIterm2Key,
  ITERM2_KEYS,
  mergeIterm2Keys,
  validateIterm2Value,
  type Iterm2KeySpec,
} from "./iterm2Keys";

describe("iterm2Keys", () => {
  it("finds a known key", () => {
    expect(findIterm2Key("Name")?.type).toBe("text");
    expect(findIterm2Key("Normal Font")?.type).toBe("text");
    expect(findIterm2Key("Cursor Type")?.type).toBe("enum");
    expect(findIterm2Key("Custom Command")?.type).toBe("yesno");
  });

  it("returns undefined for unknown key", () => {
    expect(findIterm2Key("Not A Real Key")).toBeUndefined();
  });

  it("filters by query with empty query returning full list", () => {
    expect(filterIterm2Keys("")).toHaveLength(ITERM2_KEYS.length);
    expect(filterIterm2Keys("  ")).toHaveLength(ITERM2_KEYS.length);
  });

  it("filters by key name (case-insensitive)", () => {
    const out = filterIterm2Keys("cursor");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((k) => k.key.toLowerCase().includes("cursor"))).toBe(true);
  });

  it("filters by zh description", () => {
    const out = filterIterm2Keys("回滚");
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((k) => k.key === "Scrollback Lines")).toBe(true);
  });

  it("returns empty for unmatched query", () => {
    expect(filterIterm2Keys("zzz-no-such-key")).toEqual([]);
  });

  it("validates enum values", () => {
    const spec = findIterm2Key("Cursor Type")!;
    expect(validateIterm2Value(spec, "box")).toBeNull();
    expect(validateIterm2Value(spec, "vertical bar")).toBeNull();
    expect(validateIterm2Value(spec, "nope")).toContain("值必须是以下之一");
  });

  it("rejects enum value when spec lacks enum list", () => {
    const spec: Iterm2KeySpec = {
      key: "x",
      type: "enum",
      description: "",
      zh: "",
      category: "",
    };
    expect(validateIterm2Value(spec, "v")).toBe("值必须是以下之一：");
  });

  it("validates bool values", () => {
    const spec = findIterm2Key("Blur")!;
    expect(validateIterm2Value(spec, "true")).toBeNull();
    expect(validateIterm2Value(spec, "false")).toBeNull();
    expect(validateIterm2Value(spec, "yes")).toBe("值必须是 true 或 false");
  });

  it("validates yesno values case-insensitively", () => {
    const spec = findIterm2Key("Custom Command")!;
    expect(validateIterm2Value(spec, "Yes")).toBeNull();
    expect(validateIterm2Value(spec, "yes")).toBeNull();
    expect(validateIterm2Value(spec, "NO")).toBeNull();
    expect(validateIterm2Value(spec, "maybe")).toBe("值必须是 Yes 或 No");
  });

  it("validates number values with min/max", () => {
    const spec = findIterm2Key("Blur Radius")!;
    expect(validateIterm2Value(spec, "15")).toBeNull();
    expect(validateIterm2Value(spec, "-1")).toContain("不能小于");
    expect(validateIterm2Value(spec, "31")).toContain("不能大于");
    expect(validateIterm2Value(spec, "abc")).toBe("值必须是数字");
  });

  it("validates color hex values", () => {
    const spec = findIterm2Key("Background Color")!;
    expect(validateIterm2Value(spec, "#ff0000")).toBeNull();
    expect(validateIterm2Value(spec, "#ff000080")).toBeNull();
    expect(validateIterm2Value(spec, "red")).toContain("颜色必须是");
  });

  it("validates color array values in 0-255 range", () => {
    const spec = findIterm2Key("Foreground Color")!;
    expect(validateIterm2Value(spec, "[0.5, 0.5, 0.5]")).toBeNull();
    expect(validateIterm2Value(spec, "[1, 2, 3, 1]")).toBeNull();
    expect(validateIterm2Value(spec, "[300, 0, 0]")).toContain("0-255");
    expect(validateIterm2Value(spec, "[1, 2]")).toContain("颜色必须是");
  });

  it("passes text values without validation", () => {
    const spec = findIterm2Key("Name")!;
    expect(validateIterm2Value(spec, "anything at all")).toBeNull();
  });

  it("maintains data integrity: unique keys, enum has values, min <= max", () => {
    const keys = ITERM2_KEYS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ITERM2_KEYS) {
      if (k.type === "enum") {
        expect(k.enum && k.enum.length > 0).toBe(true);
      }
      if (k.min !== undefined && k.max !== undefined) {
        expect(k.min).toBeLessThanOrEqual(k.max);
      }
    }
  });

  it("covers the official iterm2 key set", () => {
    expect(ITERM2_KEYS.length).toBe(98);
  });

  it("includes all 16 ansi colors", () => {
    for (let i = 0; i <= 15; i += 1) {
      const spec = findIterm2Key(`Ansi ${i} Color`);
      expect(spec?.type).toBe("color");
      expect(spec?.zh.length).toBeGreaterThan(0);
    }
  });

  it("finds by custom keys list", () => {
    const custom: Iterm2KeySpec[] = [
      { key: "new-key", type: "bool", description: "", zh: "", category: "" },
    ];
    expect(findIterm2Key("new-key", custom)).toBe(custom[0]);
    expect(findIterm2Key("Name", custom)).toBeUndefined();
  });

  it("filters by custom keys list", () => {
    const custom: Iterm2KeySpec[] = [
      { key: "alpha", type: "text", description: "first", zh: "", category: "" },
      { key: "beta", type: "text", description: "second", zh: "", category: "" },
    ];
    expect(filterIterm2Keys("alpha", custom)).toEqual([custom[0]]);
    expect(filterIterm2Keys("", custom)).toHaveLength(2);
    expect(filterIterm2Keys("none", custom)).toEqual([]);
  });

  it("merges remote keys keeping local annotations", () => {
    const base: Iterm2KeySpec[] = [
      {
        key: "Name",
        type: "text",
        description: "local desc",
        zh: "",
        category: "基本信息",
      },
    ];
    const remote = [
      { key: "Name", description: "remote desc", category: "基本信息" },
      { key: "Brand New Key", description: "new option", category: "其他" },
    ];
    const merged = mergeIterm2Keys(remote, base);
    expect(merged).toHaveLength(2);
    const name = merged.find((k) => k.key === "Name")!;
    expect(name.type).toBe("text");
    expect(name.description).toBe("local desc");
    const fresh = merged.find((k) => k.key === "Brand New Key")!;
    expect(fresh.type).toBe("text");
    expect(fresh.description).toBe("new option");
    expect(fresh.zh).toBe("new option");
    expect(fresh.category).toBe("其他");
  });

  it("merges keeps local-only keys and sorts by key name", () => {
    const base: Iterm2KeySpec[] = [
      { key: "zz-local", type: "text", description: "local", zh: "", category: "" },
      { key: "aa-local", type: "bool", description: "local2", zh: "", category: "" },
    ];
    const merged = mergeIterm2Keys(
      [{ key: "mm-remote", description: "r", category: "" }],
      base,
    );
    expect(merged.map((k) => k.key)).toEqual(["aa-local", "mm-remote", "zz-local"]);
    expect(merged.find((k) => k.key === "zz-local")?.type).toBe("text");
  });

  it("merges with default base list", () => {
    const remote = [{ key: "Name", description: "d", category: "c" }];
    const merged = mergeIterm2Keys(remote);
    expect(merged.find((k) => k.key === "Name")?.type).toBe("text");
  });
});
