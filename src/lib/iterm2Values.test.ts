import { describe, expect, it } from "vitest";
import {
  arrayColorToHex,
  inferIterm2ValueType,
  resolveIterm2EntryType,
  toIterm2JsonValue,
  type Iterm2ScalarEntry,
} from "./iterm2Values";
import type { Iterm2KeySpec } from "./iterm2Keys";

describe("iterm2Values", () => {
  it("infers yesno from Yes/No case-insensitively", () => {
    expect(inferIterm2ValueType("Yes")).toBe("yesno");
    expect(inferIterm2ValueType("no")).toBe("yesno");
    expect(inferIterm2ValueType("NO")).toBe("yesno");
    expect(inferIterm2ValueType("maybe")).toBe("text");
  });

  it("infers color arrays as color", () => {
    expect(inferIterm2ValueType("[0.5, 0.5, 0.5]")).toBe("color");
    expect(inferIterm2ValueType("[1, 2, 3, 1]")).toBe("color");
    expect(inferIterm2ValueType("[1, 2]")).toBe("text");
  });

  it("infers hex colors, numbers, booleans and text", () => {
    expect(inferIterm2ValueType("#ff0000")).toBe("color");
    expect(inferIterm2ValueType("12")).toBe("number");
    expect(inferIterm2ValueType("true")).toBe("bool");
    expect(inferIterm2ValueType("Hello")).toBe("text");
  });

  it("prefers list type over inferred type", () => {
    const custom: Iterm2KeySpec[] = [
      {
        key: "Cursor Type",
        type: "enum",
        enum: ["box", "bar"],
        description: "",
        zh: "",
        category: "",
      },
    ];
    expect(resolveIterm2EntryType("Cursor Type", "box", custom)).toBe("enum");
    expect(resolveIterm2EntryType("Cursor Type", "any string", custom)).toBe("enum");
  });

  it("falls back to inference for unknown keys", () => {
    expect(resolveIterm2EntryType("No Such Key", "Yes")).toBe("yesno");
    expect(resolveIterm2EntryType("No Such Key", "42")).toBe("number");
  });

  it("uses list type from the default list", () => {
    expect(resolveIterm2EntryType("Custom Command", "Yes")).toBe("yesno");
    expect(resolveIterm2EntryType("Blur", "true")).toBe("bool");
    expect(resolveIterm2EntryType("Background Color", "#fff")).toBe("color");
  });

  it("converts bool and number entries to JSON values", () => {
    expect(toIterm2JsonValue({ key: "Blur", value: "true", type: "bool" })).toBe(true);
    expect(toIterm2JsonValue({ key: "Blur", value: "false", type: "bool" })).toBe(false);
    expect(toIterm2JsonValue({ key: "Blur Radius", value: "15", type: "number" })).toBe(15);
  });

  it("keeps yesno entries as strings", () => {
    expect(toIterm2JsonValue({ key: "Custom Command", value: "Yes", type: "yesno" })).toBe(
      "Yes",
    );
    expect(toIterm2JsonValue({ key: "Custom Command", value: "No", type: "yesno" })).toBe("No");
  });

  it("converts color arrays to JSON arrays", () => {
    const entry: Iterm2ScalarEntry = {
      key: "Background Color",
      value: "[0.33, 0.13, 0.14, 1]",
      type: "color",
    };
    expect(toIterm2JsonValue(entry)).toEqual([0.33, 0.13, 0.14, 1]);
  });

  it("keeps non-array colors as strings", () => {
    expect(toIterm2JsonValue({ key: "Background Color", value: "#ff0000", type: "color" })).toBe(
      "#ff0000",
    );
  });

  it("keeps text entries as strings", () => {
    expect(toIterm2JsonValue({ key: "Name", value: "My Profile", type: "text" })).toBe(
      "My Profile",
    );
  });

  it("converts array colors to hex for the picker", () => {
    expect(arrayColorToHex("[0.5, 0.5, 0.5]")).toBe("#808080");
    expect(arrayColorToHex("[255, 0, 0]")).toBe("#ff0000");
    expect(arrayColorToHex("[0, 128, 255, 1]")).toBe("#0080ff");
  });

  it("returns null for invalid array colors", () => {
    expect(arrayColorToHex("red")).toBeNull();
    expect(arrayColorToHex("[1, 2]")).toBeNull();
    expect(arrayColorToHex("#ff0000")).toBeNull();
  });
});
