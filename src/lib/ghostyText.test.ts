import { describe, expect, it } from "vitest";
import {
  applyGhostyChanges,
  inferGhostyValueType,
  parseGhostyLines,
  resolveGhostyEntryType,
} from "./ghostyText";

describe("ghostyText", () => {
  it("infers value types", () => {
    expect(inferGhostyValueType("true")).toBe("bool");
    expect(inferGhostyValueType("false")).toBe("bool");
    expect(inferGhostyValueType("-12.5")).toBe("number");
    expect(inferGhostyValueType("#1a2b3c")).toBe("color");
    expect(inferGhostyValueType("rgb(1, 2, 3)")).toBe("color");
    expect(inferGhostyValueType("hello world")).toBe("text");
  });

  it("resolves entry type from key list first", () => {
    expect(resolveGhostyEntryType("cursor-style", "foo")).toBe("enum");
    expect(resolveGhostyEntryType("mouse-reporting", "foo")).toBe("bool");
    expect(resolveGhostyEntryType("cursor-opacity", "foo")).toBe("number");
    expect(resolveGhostyEntryType("background", "foo")).toBe("color");
    expect(resolveGhostyEntryType("title", "true")).toBe("text");
    expect(resolveGhostyEntryType("font-family", "Menlo")).toBe("font");
  });

  it("falls back to value inference for unknown keys", () => {
    expect(resolveGhostyEntryType("unknown-key", "true")).toBe("bool");
    expect(resolveGhostyEntryType("unknown-key", "12.5")).toBe("number");
    expect(resolveGhostyEntryType("unknown-key", "#abc")).toBe("color");
    expect(resolveGhostyEntryType("unknown-key", "hello")).toBe("text");
  });
  it("classifies lines into kv/comment/blank", () => {
    const lines = parseGhostyLines(`# wallpaper
background-opacity = 0.75

background-image = /path/img.jpg`);
    expect(lines.map((l) => l.type)).toEqual([
      "comment",
      "kv",
      "blank",
      "kv",
    ]);
    const kv = lines.filter((l) => l.type === "kv");
    expect(kv[0]).toMatchObject({ key: "background-opacity", value: "0.75" });
    expect(kv[1]).toMatchObject({ key: "background-image", value: "/path/img.jpg" });
  });

  it("updates a value in place preserving indent and other lines", () => {
    const lines = parseGhostyLines(`# wallpaper
  background-opacity = 0.75
background-image = /path/img.jpg`);
    const out = applyGhostyChanges(lines, {
      set: new Map([["background-opacity", "0.5"]]),
      remove: new Set(),
    });
    expect(out).toBe(`# wallpaper
  background-opacity = 0.5
background-image = /path/img.jpg`);
  });

  it("removes a key line and keeps the rest", () => {
    const lines = parseGhostyLines(`background-opacity = 0.75
# keep me
background-image = /path/img.jpg`);
    const out = applyGhostyChanges(lines, {
      set: new Map(),
      remove: new Set(["background-opacity"]),
    });
    expect(out).toBe(`# keep me
background-image = /path/img.jpg`);
  });

  it("appends new keys at the end", () => {
    const lines = parseGhostyLines(`background-opacity = 0.75
# keep`);
    const out = applyGhostyChanges(lines, {
      set: new Map([["font-size", "13"]]),
      remove: new Set(),
    });
    expect(out).toBe(`background-opacity = 0.75
# keep
font-size = 13`);
  });

  it("keeps comments and blank lines untouched", () => {
    const lines = parseGhostyLines(`# a

background-opacity = 0.75

# b`);
    const out = applyGhostyChanges(lines, {
      set: new Map([["background-opacity", "0.8"]]),
      remove: new Set(),
    });
    expect(out).toBe(`# a

background-opacity = 0.8

# b`);
  });
});
