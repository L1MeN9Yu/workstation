import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import OpenLogDirButton from "./OpenLogDirButton";
import { toast } from "../lib/toast";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("../lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

function setup(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<OpenLogDirButton />);
  });
  return root;
}

async function clickOpen(container: HTMLElement): Promise<void> {
  const button = container.querySelector("button");
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
  });
}

describe("OpenLogDirButton", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = setup(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders button and invokes open_log_dir on click", async () => {
    expect(container.textContent).toContain("打开日志目录");
    await clickOpen(container);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("open_log_dir");
  });

  it("shows a success toast when invoke succeeds", async () => {
    await clickOpen(container);
    expect(toast.success).toHaveBeenCalledWith("已打开日志目录");
    expect(toast.error).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("已打开日志目录");
  });

  it("shows an error toast when invoke rejects", async () => {
    invokeMock.mockRejectedValue(new Error("log dir unavailable"));
    await clickOpen(container);
    expect(toast.error).toHaveBeenCalledWith("Error: log dir unavailable");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("is disabled while opening", async () => {
    let resolveInvoke: () => void = () => {};
    invokeMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    const button = container.querySelector("button");
    act(() => {
      button!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(button!.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      resolveInvoke();
    });
    expect(button!.hasAttribute("disabled")).toBe(false);
  });
});
