import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import ToastHost from "./ToastHost";
import { useTheme } from "../store/theme";

function setup(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ToastHost />);
  });
  return root;
}

function toasterList(container: HTMLElement): Element | null {
  return container.querySelector("ol[data-sonner-toaster]");
}

function showToast(): void {
  act(() => {
    toast.success("测试");
  });
}

async function waitForToaster(container: HTMLElement): Promise<Element> {
  await vi.waitFor(() => {
    const toaster = toasterList(container);
    expect(toaster).not.toBeNull();
    return toaster;
  });
  return toasterList(container)!;
}

describe("ToastHost", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    toast.dismiss();
    useTheme.setState({
      theme: "light",
      resolvedTheme: "light",
      accent: "blue",
      _userTouched: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = setup(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    toast.dismiss();
  });

  it("renders the sonner toaster at the top-right position", async () => {
    showToast();
    const toaster = await waitForToaster(container);
    expect(toaster.getAttribute("data-x-position")).toBe("right");
    expect(toaster.getAttribute("data-y-position")).toBe("top");
  });

  it("follows the resolved light theme", async () => {
    showToast();
    const toaster = await waitForToaster(container);
    expect(toaster.getAttribute("data-sonner-theme")).toBe("light");
  });

  it("re-renders with the dark theme after the resolved theme changes", async () => {
    act(() => {
      useTheme.setState({ resolvedTheme: "dark" });
    });
    showToast();
    const toaster = await waitForToaster(container);
    expect(toaster.getAttribute("data-sonner-theme")).toBe("dark");
  });
});
