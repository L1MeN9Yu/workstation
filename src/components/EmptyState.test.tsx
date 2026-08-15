import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders children inside a dashed placeholder box", () => {
    root = createRoot(container);
    act(() => {
      root.render(<EmptyState>暂无数据</EmptyState>);
    });
    const div = container.querySelector("div")!;
    expect(div.textContent).toBe("暂无数据");
    expect(div.className).toContain("border-dashed");
    expect(div.className).toContain("border-gray-300");
    expect(div.className).toContain("flex h-40");
  });

  it("accepts a custom className", () => {
    root = createRoot(container);
    act(() => {
      root.render(<EmptyState className="flex h-32">空</EmptyState>);
    });
    const div = container.querySelector("div")!;
    expect(div.className).toContain("flex h-32");
    expect(div.className).not.toContain("flex h-40");
  });
});
