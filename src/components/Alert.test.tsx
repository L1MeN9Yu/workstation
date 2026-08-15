import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Alert, { type AlertVariant } from "./Alert";

function setup(container: HTMLElement, variant?: AlertVariant): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<Alert variant={variant}>内容</Alert>);
  });
  return root;
}

describe("Alert", () => {
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

  it("renders an error variant with red classes", () => {
    root = setup(container, "error");
    const div = container.querySelector("div")!;
    expect(div.textContent).toBe("内容");
    expect(div.className).toContain("border-red-300");
    expect(div.className).toContain("dark:bg-red-950");
  });

  it("renders a warning variant with amber classes", () => {
    root = setup(container, "warning");
    const div = container.querySelector("div")!;
    expect(div.className).toContain("border-amber-300");
    expect(div.className).toContain("bg-amber-50");
  });

  it("renders an info variant with gray classes by default", () => {
    root = setup(container);
    const div = container.querySelector("div")!;
    expect(div.className).toContain("border-gray-200");
    expect(div.className).toContain("bg-gray-50");
    expect(div.className).toContain("mb-3");
  });

  it("accepts a custom className", () => {
    root = setup(container);
    const div = container.querySelector("div")!;
    expect(div.className).toContain("mb-3");
  });

  it("renders ReactNode children", () => {
    root = setup(container);
    expect(container.querySelector("div")?.textContent).toBe("内容");
  });
});
