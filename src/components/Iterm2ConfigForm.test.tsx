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
    "Custom Command": "Yes",
    "Cursor Type": "box",
    "Background Color": [0.33, 0.13, 0.14, 1],
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

function keySelect(container: HTMLElement): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>('select[title="从官方支持的 key 中选择"]');
  expect(el).not.toBeNull();
  return el!;
}

function addValueControl(container: HTMLElement): HTMLSelectElement | HTMLInputElement {
  const area = container.querySelector<HTMLElement>("div.mb-4.space-y-2");
  expect(area).not.toBeNull();
  const number = area?.querySelector<HTMLInputElement>('input[type="number"]');
  if (number) return number;
  const select = area?.querySelector<HTMLSelectElement>(
    'select:not([title="从官方支持的 key 中选择"])',
  );
  if (select) return select;
  const input = area?.querySelector<HTMLInputElement>("input");
  expect(input).not.toBeNull();
  return input!;
}

function entryRow(container: HTMLElement, key: string): HTMLElement {
  const rows = [...container.querySelectorAll<HTMLElement>("div.flex.items-center.gap-2")];
  const row = rows.find((r) => r.querySelector("span")?.textContent === key);
  expect(row).not.toBeUndefined();
  return row!;
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

  it("renders list-typed controls for known keys", () => {
    root = mount(container);
    const customRow = entryRow(container, "Custom Command");
    const customSelect = customRow.querySelector<HTMLSelectElement>("select");
    expect(customSelect?.value).toBe("Yes");
    expect([...customSelect!.options].map((o) => o.value)).toEqual(["Yes", "No"]);
    const cursorRow = entryRow(container, "Cursor Type");
    const cursorSelect = cursorRow.querySelector<HTMLSelectElement>("select");
    expect(cursorSelect?.value).toBe("box");
    expect([...cursorSelect!.options].map((o) => o.value)).toEqual([
      "box",
      "bar",
      "underline",
      "vertical bar",
    ]);
  });

  it("renders color arrays as editable color controls", () => {
    root = mount(container);
    const row = entryRow(container, "Background Color");
    const picker = row.querySelector<HTMLInputElement>('input[type="color"]');
    expect(picker).not.toBeNull();
    expect(picker?.value).toBe("#542124");
    const text = row.querySelector<HTMLInputElement>('input:not([type="color"])');
    expect(text?.value).toBe("[0.33,0.13,0.14,1]");
  });

  it("shows zh descriptions as entry hover titles and dropdown labels", () => {
    root = mount(container);
    const nameRow = entryRow(container, "Name");
    expect(nameRow.querySelector("span")?.title).toBe("配置名称（必填）");
    const select = keySelect(container);
    const cursorOption = [...select.options].find((o) => o.value === "Cursor Type");
    expect(cursorOption?.textContent).toContain("光标样式");
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
          "Custom Command": "Yes",
          "Cursor Type": "box",
          "Background Color": [0.33, 0.13, 0.14, 1],
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

  it("adds a new key from the list with a typed control and saves", async () => {
    root = mount(container);
    setSelectValue(keySelect(container), "Scrollback Lines");
    const control = addValueControl(container) as HTMLInputElement;
    expect(control.type).toBe("number");
    setInputValue(control, "1000");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("Scrollback Lines");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      expect.stringContaining('"Scrollback Lines": 1000'),
    );
  });

  it("adds a yesno key keeping the string form", async () => {
    root = mount(container);
    setSelectValue(keySelect(container), "Custom Command");
    const control = addValueControl(container) as HTMLSelectElement;
    expect([...control.options].map((o) => o.value)).toEqual(["Yes", "No"]);
    setSelectValue(control, "No");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("键 Custom Command 已存在");
  });

  it("rejects out-of-range number on add", async () => {
    root = mount(container);
    setSelectValue(keySelect(container), "Blur Radius");
    const control = addValueControl(container) as HTMLInputElement;
    setInputValue(control, "99");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("值不能大于 30");
  });

  it("validates list values on save and keeps original content", async () => {
    root = mount(container);
    setSelectValue(keySelect(container), "Transparency");
    const control = addValueControl(container) as HTMLInputElement;
    setInputValue(control, "0.5");
    await clickButton(container, "新增");
    const row = entryRow(container, "Transparency");
    const number = row.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "2");
    await clickButton(container, "保存");
    expect(container.textContent).toContain("值不能大于 1");
    expect(writeIterm2Profile).not.toHaveBeenCalled();
  });

  it("saves color arrays back as JSON arrays", async () => {
    root = mount(container);
    const row = entryRow(container, "Background Color");
    const text = row.querySelector<HTMLInputElement>('input:not([type="color"])');
    setInputValue(text!, "[1, 0, 0]");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      expect.stringContaining('"Background Color": [\n    1,\n    0,\n    0\n  ]'),
    );
  });

  it("edits unknown keys with inferred controls", async () => {
    root = mount(container);
    const row = entryRow(container, "Opacity");
    const number = row.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "0.9");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "default.json",
      expect.stringContaining('"Opacity": 0.9'),
    );
  });

  it("shows conflict hint when adding an existing key", async () => {
    root = mount(container);
    setSelectValue(keySelect(container), "Name");
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

  it("passes the saved message to onSaved", async () => {
    const onSaved = vi.fn();
    root = mount(container, { onSaved });
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "0.5");
    await clickButton(container, "保存");
    expect(onSaved).toHaveBeenCalledWith("已保存（修改 1 项，删除 0 项）");
  });

  it("edits the first profile inside the Profiles wrapper and writes back wrapped", async () => {
    const dp = JSON.stringify(
      { Profiles: [{ Name: "NIO", "Cursor Type": 1, Opacity: 0.5 }] },
      null,
      2,
    );
    root = mount(container, { name: "dp.json", content: dp });
    expect(container.textContent).toContain("Cursor Type");
    expect(container.textContent).toContain("Name");
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "0.9");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "dp.json",
      JSON.stringify(
        { Profiles: [{ Name: "NIO", "Cursor Type": 1, Opacity: 0.9 }] },
        null,
        2,
      ),
    );
  });

  it("keeps other profiles untouched when saving the first one", async () => {
    const multi = JSON.stringify(
      { Profiles: [{ Name: "A", Opacity: 0.5 }, { Name: "B", Opacity: 1 }] },
      null,
      2,
    );
    root = mount(container, { name: "m.json", content: multi });
    expect(container.textContent).toContain("该文件包含 2 个 profile");
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    setInputValue(number!, "0.9");
    await clickButton(container, "保存");
    expect(writeIterm2Profile).toHaveBeenCalledWith(
      "m.json",
      JSON.stringify(
        { Profiles: [{ Name: "A", Opacity: 0.9 }, { Name: "B", Opacity: 1 }] },
        null,
        2,
      ),
    );
  });

  it("shows out-of-enum values as an extra option in the enum select", () => {
    const dp = JSON.stringify({ Profiles: [{ "Cursor Type": 1 }] }, null, 2);
    root = mount(container, { name: "ct.json", content: dp });
    const row = entryRow(container, "Cursor Type");
    const select = row.querySelector<HTMLSelectElement>("select");
    expect(select).not.toBeNull();
    expect([...select!.options].map((o) => o.value)).toEqual([
      "box",
      "bar",
      "underline",
      "vertical bar",
      "1",
    ]);
  });

  it("shows empty state for an empty profile inside the wrapper", () => {
    root = mount(container, { name: "empty-profile.json", content: '{"Profiles": [{}]}' });
    expect(container.textContent).toContain("暂无配置项，可在下方新增");
  });

  it("shows empty state for empty object and supports adding", async () => {
    root = mount(container, { name: "empty.json", content: "{}" });
    expect(container.textContent).toContain("暂无配置项，可在下方新增");
    setSelectValue(keySelect(container), "Name");
    const control = addValueControl(container) as HTMLInputElement;
    setInputValue(control, "NIO");
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
