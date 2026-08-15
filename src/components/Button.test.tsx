import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Button, { type ButtonVariant } from "./Button";

function setup(
  container: HTMLElement,
  props: { variant?: ButtonVariant; disabled?: boolean; onClick?: () => void } = {},
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <Button variant={props.variant} disabled={props.disabled} onClick={props.onClick}>
        按钮
      </Button>,
    );
  });
  return root;
}

describe("Button", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders a primary button with accent classes", () => {
    root = setup(container, { variant: "primary" });
    const btn = container.querySelector("button")!;
    expect(btn.textContent).toBe("按钮");
    expect(btn.className).toContain("bg-accent-600");
    expect(btn.className).toContain("text-white");
  });

  it("renders a secondary button by default", () => {
    root = setup(container);
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("bg-gray-200");
    expect(btn.className).toContain("dark:bg-gray-700");
  });

  it("renders a danger button with red classes", () => {
    root = setup(container, { variant: "danger" });
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("bg-red-600");
    expect(btn.className).toContain("text-white");
  });

  it("renders a dangerText button with small red text", () => {
    root = setup(container, { variant: "dangerText" });
    const btn = container.querySelector("button")!;
    expect(btn.className).toContain("text-red-500");
    expect(btn.className).toContain("text-xs");
  });

  it("passes disabled state and fires onClick", () => {
    const onClick = vi.fn();
    root = setup(container, { disabled: true, onClick });
    const btn = container.querySelector("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
    act(() => {
      btn.click();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    root = setup(container, { onClick });
    const btn = container.querySelector("button")!;
    act(() => {
      btn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
