import { describe, expect, it } from "vitest";
import { mergeCmuxJsonc, parseCmuxJsonc } from "./cmuxJsonc";

const TEMPLATE = `{
  "$schema": "https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux.schema.json",
  "schemaVersion": 1,

  // This file uses JSON with comments (JSONC).
  //   "app" : {
  //     "appearance" : "system",
  //     "confirmQuit" : "always"
  //   },

  //   "terminal" : {
  //     "scrollSpeed" : 1
  //   }
}`;

describe("cmuxJsonc", () => {
  it("parses template state: comments are not explicit fields", () => {
    const p = parseCmuxJsonc(TEMPLATE);
    expect(p.hasErrors).toBe(false);
    expect(p.json.schemaVersion).toBe(1);
    expect(p.explicitPaths).toEqual(["$schema", "schemaVersion"]);
  });

  it("parses mixed state: explicit fields include real entities only", () => {
    const content = `{
  "schemaVersion": 1,
  //  "app": { "appearance": "system" }
  "terminal": { "scrollSpeed": 2 }
}`;
    const p = parseCmuxJsonc(content);
    expect(p.explicitPaths).toContain("terminal.scrollSpeed");
    expect(p.explicitPaths).not.toContain("app.appearance");
  });

  it("reports syntax errors", () => {
    const p = parseCmuxJsonc(`{ "broken": }`);
    expect(p.hasErrors).toBe(true);
  });

  it("collects explicit paths inside arrays", () => {
    const p = parseCmuxJsonc(`{
  "terminal": {
    "resumeCommands": [ { "command": "echo hi" } ]
  }
}`);
    expect(p.explicitPaths).toContain("terminal.resumeCommands.0.command");
  });

  it("updates array field values", () => {
    const content = `{ "terminal": { "resumeCommands": ["a"] } }`;
    const { text, errors } = mergeCmuxJsonc(content, [
      { path: ["terminal", "resumeCommands"], value: ["a", "b"] },
    ]);
    expect(errors).toEqual([]);
    const p = parseCmuxJsonc(text);
    expect((p.json as Record<string, unknown>).terminal).toMatchObject({ resumeCommands: ["a", "b"] });
  });

  it("updates existing field keeping comments and untouched content", () => {
    const content = `{
  // keep me
  "schemaVersion": 1,
  "app": {
    "appearance": "system"
  }
}`;
    const { text, errors } = mergeCmuxJsonc(content, [
      { path: ["app", "appearance"], value: "dark" },
    ]);
    expect(errors).toEqual([]);
    expect(text).toContain("// keep me");
    expect(text).toContain('"appearance": "dark"');
    expect(text).toContain('"schemaVersion": 1');
  });

  it("sets a new field inside a group that only exists as comments", () => {
    const { text, errors } = mergeCmuxJsonc(TEMPLATE, [
      { path: ["app", "appearance"], value: "dark" },
    ]);
    expect(errors).toEqual([]);
    expect(text).toContain('"app": {');
    expect(text).toContain('"appearance": "dark"');
    expect(text).toContain('"schemaVersion": 1');
    expect(text).toContain("// This file uses JSON with comments (JSONC).");
  });

  it("returns error on invalid JSONC instead of corrupting the file", () => {
    const { text, errors } = mergeCmuxJsonc(`{ "broken": }`, [
      { path: ["app"], value: {} },
    ]);
    expect(text).toBe("");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns original content when there are no changes", () => {
    const content = `{ "schemaVersion": 1 }`;
    const { text, errors } = mergeCmuxJsonc(content, []);
    expect(errors).toEqual([]);
    expect(text).toBe(content);
  });

  it("rejects writes whose parent is not an object", () => {
    const content = `{ "app": 5 }`;
    const { text, errors } = mergeCmuxJsonc(content, [
      { path: ["app", "appearance"], value: "dark" },
    ]);
    expect(text).toBe("");
    expect(errors.join("")).toContain("父级不是配置对象");
  });

  it("rejects writes through a non-object intermediate parent", () => {
    const content = `{ "app": 5 }`;
    const { text, errors } = mergeCmuxJsonc(content, [
      { path: ["app", "x", "y"], value: 1 },
    ]);
    expect(text).toBe("");
    expect(errors.join("")).toContain("父级不是配置对象");
  });

  it("handles empty content", () => {
    const p = parseCmuxJsonc("");
    expect(p.json).toEqual({});
    expect(p.explicitPaths).toEqual([]);
    expect(p.hasErrors).toBe(true);
  });

  it("writes single-level dirty paths", () => {
    const content = `{ "app": {} }`;
    const { text, errors } = mergeCmuxJsonc(content, [
      { path: ["app"], value: { appearance: "dark" } },
    ]);
    expect(errors).toEqual([]);
    const p = parseCmuxJsonc(text);
    expect((p.json as Record<string, unknown>).app).toMatchObject({ appearance: "dark" });
  });

  it("creates nested groups along the path", () => {
    const content = `{ "schemaVersion": 1 }`;
    const { text, errors } = mergeCmuxJsonc(content, [
      { path: ["shortcuts", "bindings", "find"], value: "cmd+f" },
    ]);
    expect(errors).toEqual([]);
    const p = parseCmuxJsonc(text);
    expect((p.json as Record<string, unknown>).shortcuts).toMatchObject({ bindings: { find: "cmd+f" } });
    expect(p.explicitPaths).toContain("shortcuts.bindings.find");
  });

  it("parses empty objects and arrays without explicit paths", () => {
    const p = parseCmuxJsonc(`{ "empty": {}, "list": [] }`);
    expect(p.hasErrors).toBe(false);
    expect(p.explicitPaths).toEqual(["empty", "list"]);
  });
});
