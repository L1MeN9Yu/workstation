import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReloadConfigButton from "./ReloadConfigButton";
import { reloadCmuxConfig } from "../lib/cmuxConfig";

vi.mock("../lib/cmuxConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/cmuxConfig")>();
  return { ...actual, reloadCmuxConfig: vi.fn() };
});

function setup(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ReloadConfigButton />);
  });
  return root;
}

async function clickReload(container: HTMLElement): Promise<void> {
  const button = container.querySelector("button");
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
  });
}

describe("ReloadConfigButton", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(reloadCmuxConfig).mockReset();
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

  it("renders reload button and calls reloadCmuxConfig on click", async () => {
    vi.mocked(reloadCmuxConfig).mockResolvedValue({ status: "success" });
    expect(container.textContent).toContain("重新加载配置");
    await clickReload(container);
    expect(reloadCmuxConfig).toHaveBeenCalledTimes(1);
  });

  it("shows success message when reload succeeds", async () => {
    vi.mocked(reloadCmuxConfig).mockResolvedValue({ status: "success" });
    await clickReload(container);
    expect(container.textContent).toContain("已生效");
  });

  it("shows notRunning message when cmux is not running", async () => {
    vi.mocked(reloadCmuxConfig).mockResolvedValue({ status: "notRunning" });
    await clickReload(container);
    expect(container.textContent).toContain("cmux 未运行");
  });

  it("shows cliMissing message when cmux cli is missing", async () => {
    vi.mocked(reloadCmuxConfig).mockResolvedValue({ status: "cliMissing" });
    await clickReload(container);
    expect(container.textContent).toContain("未找到 cmux 命令");
  });

  it("shows failed message with detail when reload fails", async () => {
    vi.mocked(reloadCmuxConfig).mockResolvedValue({
      status: "failed",
      message: "socket refused",
    });
    await clickReload(container);
    expect(container.textContent).toContain("socket refused");
  });

  it("shows failed message when invoke rejects", async () => {
    vi.mocked(reloadCmuxConfig).mockRejectedValue(new Error("invoke error"));
    await clickReload(container);
    expect(container.textContent).toContain("invoke error");
  });
});
