import { describe, expect, it } from "vitest";
import { registerTool, toolRegistry, type ToolEntry } from "./toolsRegistry";

const FakeComponent = () => null;

describe("toolsRegistry", () => {
  it("has base64 registered by default", () => {
    const base64 = toolRegistry.find((t) => t.id === "base64");
    expect(base64).toBeDefined();
    expect(base64?.label).toBe("Base64 编解码");
    expect(base64?.path).toBe("/tools/base64");
    expect(typeof base64?.component).toBe("function");
  });

  it("registerTool appends a new unique entry", () => {
    const entry: ToolEntry = {
      id: "hash",
      label: "Hash",
      path: "/tools/hash",
      component: FakeComponent,
    };
    registerTool(entry);
    expect(toolRegistry.find((t) => t.id === "hash")).toBeDefined();
  });

  it("registerTool ignores duplicate ids", () => {
    const count = toolRegistry.length;
    const entry: ToolEntry = {
      id: "base64",
      label: "Duplicate",
      path: "/tools/dupe",
      component: FakeComponent,
    };
    registerTool(entry);
    expect(toolRegistry.length).toBe(count);
    expect(toolRegistry.find((t) => t.id === "base64")?.label).toBe(
      "Base64 编解码",
    );
  });
});
