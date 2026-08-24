import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  clampMenuPosition,
  useContextMenuCloser,
} from "./wallpaperMenu";

function TestHarness({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useContextMenuCloser(open, onClose);
  return <button type="button">harness</button>;
}

function setup(
  container: HTMLElement,
  open: boolean,
  onClose: () => void,
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<TestHarness open={open} onClose={onClose} />);
  });
  return root;
}

describe("clampMenuPosition", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  });

  it("keeps the position when well inside the viewport", () => {
    expect(clampMenuPosition(50, 80)).toEqual({ left: 50, top: 80 });
  });

  it("clamps horizontally when the menu would overflow the right edge", () => {
    const result = clampMenuPosition(800, 50);
    expect(result.left).toBe(800 - 112);
    expect(result.top).toBe(50);
  });

  it("clamps vertically when the menu would overflow the bottom edge", () => {
    const result = clampMenuPosition(50, 600);
    expect(result.left).toBe(50);
    expect(result.top).toBe(600 - 132);
  });

  it("clamps negative positions to the top-left origin", () => {
    expect(clampMenuPosition(-10, -20)).toEqual({ left: 0, top: 0 });
  });

  it("clamps both axes when near the bottom-right corner", () => {
    const result = clampMenuPosition(750, 550);
    expect(result.left).toBe(800 - 112);
    expect(result.top).toBe(600 - 132);
  });
});

describe("useContextMenuCloser", () => {
  let container: HTMLElement;
  let root: Root;
  let onClose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    onClose = vi.fn<() => void>();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not attach listeners while closed", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    root = setup(container, false, onClose);
    expect(addSpy).not.toHaveBeenCalledWith("click", expect.any(Function));
    expect(addSpy).not.toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(addSpy).not.toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("attaches and detaches click/scroll/keydown listeners while open", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    root = setup(container, true, onClose);
    expect(addSpy).toHaveBeenCalledWith("click", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

    act(() => {
      root.unmount();
    });
    expect(removeSpy).toHaveBeenCalledWith("click", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("closes on an outside click", async () => {
    root = setup(container, true, onClose);
    await act(async () => {
      window.dispatchEvent(new Event("click"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape but not on other keys", async () => {
    root = setup(container, true, onClose);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on scroll", async () => {
    root = setup(container, true, onClose);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops closing after the menu turns closed", async () => {
    root = setup(container, true, onClose);
    act(() => {
      root.render(<TestHarness open={false} onClose={onClose} />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("click"));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});