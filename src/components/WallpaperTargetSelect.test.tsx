import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WallpaperTargetSelect } from "./WallpaperTargetSelect";
import type { ApplyWallpaperTarget } from "../lib/wallpaper";

function setup(
  container: HTMLElement,
  props: {
    value: ApplyWallpaperTarget;
    onChange: (t: ApplyWallpaperTarget) => void;
    dark?: boolean;
    compact?: boolean;
  },
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<WallpaperTargetSelect {...props} />);
  });
  return root;
}

describe("WallpaperTargetSelect", () => {
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

  it("default variant keeps light background styling", () => {
    root = setup(container, { value: "cmux", onChange: vi.fn() });
    const select = container.querySelector("select")!;
    expect(select.className).toContain("bg-gray-50");
    expect(select.className).not.toContain("bg-gray-700/80");
    expect(select.className).not.toContain("text-white");
    const option = container.querySelector("option")!;
    expect(option.className).toBe("");
  });

  it("dark variant applies high-contrast classes to select and options", () => {
    root = setup(container, { value: "cmux", onChange: vi.fn(), dark: true });
    const select = container.querySelector("select")!;
    expect(select.className).toContain("bg-gray-700/80");
    expect(select.className).toContain("text-white");
    expect(select.className).toContain("hover:bg-gray-600");
    const options = container.querySelectorAll("option");
    options.forEach((o) => {
      expect(o.className).toContain("bg-gray-900");
      expect(o.className).toContain("text-white");
    });
  });

  it("compact variant applies smaller sizing", () => {
    root = setup(container, { value: "cmux", onChange: vi.fn(), compact: true });
    const select = container.querySelector("select")!;
    expect(select.className).toContain("px-1 py-0.5 text-xs");
  });

  it("calls onChange with selected target and stops propagation", () => {
    const onChange = vi.fn();
    root = setup(container, { value: "cmux", onChange });
    const select = container.querySelector("select")!;
    act(() => {
      select.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      select.dispatchEvent(new MouseEvent("change", { bubbles: true }));
      select.value = "iterm2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("iterm2");
  });
});
