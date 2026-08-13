import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Iterm2ConfigForm from "./Iterm2ConfigForm";
import { reloadIterm2Config, writeIterm2Profile } from "../lib/iterm2Config";

vi.mock("../lib/iterm2Config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/iterm2Config")>();
  return { ...actual, writeIterm2Profile: vi.fn(), reloadIterm2Config: vi.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTENT = JSON.stringify(
  {
    Name: "NIO",
    Opacity: 0.75,
    Enabled: true,
    Color: "#ff0000",
    Nested: { a: 1 },
    Tags: ["a", "b"],
  },
  null,
  2,
);

interface RenderOptions {
  name?: string;
  content?: string;
  onSaved?: () => void;
}

function mount(container: HTMLElement, options: RenderOptions = {}): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <Iterm2ConfigForm
        name={options.name ?? "default.json"}
        content={options.content ?? CONTENT}
        onSaved={options.onSaved}
      />,
    );
  });
  return root;
}

function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelectValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickButton(container: HTMLElement, text: string): Promise<void> {
  const buttons = [...container.querySelectorAll("button")];
  const btn = buttons.find((b) => b.textContent === text);
  expect(btn).not.toBeUndefined();
  await act(async () => {
    btn!.click();
  });
}

function readonlyInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>("input[readonly]")];
}

function addInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>("input")].filter(
    (i) => i.placeholder === "键名，如 Name" || i.placeholder === "值",
  );
}

describe("Iterm2ConfigForm", () => {
  let container: HTMLElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.mocked(writeIterm2Profile).mockReset();
    vi.mocked(reloadIterm2Config).mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    const mounted = root;
    if (mounted) {
      act(() => {
        mounted.unmount();
      });
    }
    container.remove();
  });

  it("renders scalar entries with inferred controls and readonly nested fields", () => {
    root = mount(container);
    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Nested");
    expect(container.textContent).toContain("Tags");
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(number?.value).toBe("0.75");
    const select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("true");
    expect(readonlyInputs(container).length).toBe(2);
    expect(readonlyInputs(container).every((i) => i.readOnly)).toBe(true);
  });

  it("edits a value and saves 2-space JSON preserving nested fields", async () => {
    const onSaved = vi.fn();
    root = mount(container, { onSaved });
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "0.5");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      JSON.stringify(
        {
          Name: "NIO",
          Opacity: 0.5,
          Enabled: true,
          Color: "#ff0000",
          Nested: { a: 1 },
          Tags: ["a", "b"],
        },
        null,
        2,
      ),
    );
    expect(container.textContent).toContain("已保存（修改 1 项，删除 0 项）");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("switches bool via select and saves", async () => {
    root = mount(container);
    const select = container.querySelector<HTMLSelectElement>("select");
    setSelectValue(select!, "false");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      expect.stringContaining('"Enabled": false'),
    );
  });

  it("adds a new entry and saves", async () => {
    root = mount(container);
    const inputs = addInputs(container);
    setInputValue(inputs[0], "FontSize");
    setInputValue(inputs[1], "13");
    await clickButton(container, "新增");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      expect.stringContaining('"FontSize": 13'),
    );
    expect(container.textContent).toContain("已保存（修改 1 项，删除 0 项）");
  });

  it("shows conflict hint when adding a duplicate key", async () => {
    root = mount(container);
    const inputs = addInputs(container);
    setInputValue(inputs[0], "Name");
    setInputValue(inputs[1], "other");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("键 Name 已存在");
  });

  it("removes an entry and saves without it", async () => {
    root = mount(container);
    await clickButton(container, "删除");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      expect.not.stringContaining("Name"),
    );
    expect(container.textContent).toContain("已保存（修改 0 项，删除 1 项）");
  });

  it("shows error and keeps form content when save fails", async () => {
    vi.mocked(writeIterm2Profile).mockRejectedValue(new Error("disk full"));
    root = mount(container);
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "0.5");
    await clickButton(container, "保存");
    expect(container.textContent).toContain("disk full");
    expect(number?.value).toBe("0.5");
    expect(writeIterm2Profile).toHaveBeenCalledTimes(1);
  });

  it("shows success message when reload succeeds", async () => {
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "success" });
    root = mount(container);
    await clickButton(container, "重新加载配置");
    expect(container.textContent).toContain("iTerm2 已重新加载配置");
  });

  it("shows notRunning message when iTerm2 is not running", async () => {
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "notRunning" });
    root = mount(container);
    await clickButton(container, "重新加载配置");
    expect(container.textContent).toContain("iTerm2 未运行");
  });

  it("shows mechanismUnavailable message", async () => {
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "mechanismUnavailable" });
    root = mount(container);
    await clickButton(container, "重新加载配置");
    expect(container.textContent).toContain("刷新机制不可用");
  });

  it("shows failed message with detail when reload fails", async () => {
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "failed", message: "boom" });
    root = mount(container);
    await clickButton(container, "重新加载配置");
    expect(container.textContent).toContain("boom");
  });

  it("shows failed message when reload invoke rejects", async () => {
    vi.mocked(reloadIterm2Config).mockRejectedValue(new Error("invoke error"));
    root = mount(container);
    await clickButton(container, "重新加载配置");
    expect(container.textContent).toContain("invoke error");
  });

  it("shows empty state for empty object and supports adding", async () => {
    root = mount(container, { name: "empty.json", content: "{}" });
    expect(container.textContent).toContain("暂无配置项，可在下方新增");
    const inputs = addInputs(container);
    setInputValue(inputs[0], "Name");
    setInputValue(inputs[1], "NIO");
    await clickButton(container, "新增");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "empty.json",
      JSON.stringify({ Name: "NIO" }, null, 2),
    );
  });

  it("treats invalid json content as empty", () => {
    root = mount(container, { name: "bad.json", content: "{not json" });
    expect(container.textContent).toContain("暂无配置项，可在下方新增");
  });
});
