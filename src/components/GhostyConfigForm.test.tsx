import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import GhostyConfigForm from "./GhostyConfigForm";
import { writeGhostyConfig } from "../lib/cmuxConfig";
import { listSystemFonts } from "../lib/systemFonts";
import { useSystemFonts } from "../store/systemFonts";

vi.mock("../lib/cmuxConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/cmuxConfig")>();
  return { ...actual, writeGhostyConfig: vi.fn() };
});

vi.mock("../lib/systemFonts", () => ({
  listSystemFonts: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTENT = `# ghosty config
font-size = 13
cursor-style = block
opacity-thing = custom-text
`;

function mount(container: HTMLElement, content = CONTENT): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<GhostyConfigForm content={content} />);
  });
  return root;
}

function setSelectValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
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

function keySelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>("select");
  expect(select).not.toBeNull();
  return select!;
}

function numberInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')];
}

function rangeInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')];
}

function selects(container: HTMLElement): HTMLSelectElement[] {
  return [...container.querySelectorAll<HTMLSelectElement>("select")];
}

describe("GhostyConfigForm", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(writeGhostyConfig).mockReset();
    vi.mocked(writeGhostyConfig).mockResolvedValue();
    vi.mocked(listSystemFonts).mockReset();
    vi.mocked(listSystemFonts).mockRejectedValue(new Error("tauri unavailable"));
    useSystemFonts.setState({ fonts: [], source: "base" });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders known keys with type controls and unknown key as text", () => {
    root = mount(container);
    expect(container.textContent).toContain("font-size");
    expect(container.textContent).toContain("cursor-style");
    expect(container.textContent).toContain("opacity-thing");
    const fontInput = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(fontInput?.value).toBe("13");
    const enumSelect = selects(container).find((s) => s.value === "block");
    expect(enumSelect).toBeDefined();
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input:not([type])')].some(
        (i) => i.value === "custom-text",
      ),
    ).toBe(true);
  });

  it("shows Chinese description as hover title on known keys", () => {
    root = mount(container);
    const keyLabel = [...container.querySelectorAll("span")].find(
      (s) => s.textContent === "font-size" && s.title !== "",
    );
    expect(keyLabel).toBeDefined();
    expect(keyLabel!.title).toContain("字体大小");
  });

  it("shows key with Chinese description in add dropdown options", () => {
    root = mount(container);
    const keySelectEl = selects(container).find((s) =>
      [...s.options].some((o) => o.value === "" && o.disabled),
    )!;
    expect(keySelectEl).toBeDefined();
    const option = [...keySelectEl.options].find((o) => o.value === "font-size");
    expect(option).toBeDefined();
    expect(option!.textContent).toContain("字体大小");
  });

  it("renders enum value not in list as an extra option", () => {
    root = mount(container, "cursor-style = weird\n");
    const select = selects(container).find((s) =>
      [...s.options].some((o) => o.value === "weird"),
    );
    expect(select?.value).toBe("weird");
  });

  it("adds a new entry from the key list and saves it", async () => {
    root = mount(container, "# only\n");
    setSelectValue(keySelect(container), "font-size");
    const number = numberInputs(container).find((i) => i.closest("div") !== null);
    expect(number).toBeDefined();
    setInputValue(number!, "15");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("font-size");
    await clickButton(container, "保存");
    expect(writeGhostyConfig).toHaveBeenCalledWith("# only\n\nfont-size = 15");
  });

  it("rejects duplicate keys on add", async () => {
    root = mount(container, "font-size = 13\n");
    setSelectValue(keySelect(container), "font-size");
    const number = numberInputs(container).find((i) => i.value !== "13");
    expect(number).toBeDefined();
    setInputValue(number!, "15");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("键 font-size 已存在");
  });

  it("blocks out-of-range number values when adding", async () => {
    root = mount(container, "# only\n");
    setSelectValue(keySelect(container), "cursor-opacity");
    const number = numberInputs(container)[0];
    expect(number).toBeDefined();
    setInputValue(number!, "2");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("不能大于");
    expect(container.textContent).toContain("暂无配置项");
  });

  it("renders enum value control with only enum options for new key", () => {
    root = mount(container, "# only\n");
    setSelectValue(keySelect(container), "cursor-style");
    const enumSelect = selects(container).find((s) => s !== keySelect(container));
    expect(enumSelect).toBeDefined();
    const options = [...enumSelect!.options].map((o) => o.value);
    expect(options).toEqual(["block", "bar", "underline", "block_hollow"]);
  });

  it("validates new entry value on save and does not write", async () => {
    root = mount(container, "# only\n");
    setSelectValue(keySelect(container), "cursor-opacity");
    const number = numberInputs(container)[0];
    setInputValue(number!, "0.5");
    await clickButton(container, "新增");
    const entryNumber = numberInputs(container)[0];
    setInputValue(entryNumber!, "2");
    await clickButton(container, "保存");
    expect(container.textContent).toContain("不能大于");
    expect(writeGhostyConfig).not.toHaveBeenCalled();
  });

  it("saves edits to existing entries preserving comments", async () => {
    root = mount(container);
    const number = numberInputs(container)[0];
    setInputValue(number!, "14");
    await clickButton(container, "保存");
    expect(writeGhostyConfig).toHaveBeenCalledWith(
      `# ghosty config
font-size = 14
cursor-style = block
opacity-thing = custom-text
`,
    );
  });

  it("removes an entry and saves without it", async () => {
    root = mount(container, "font-size = 13\nopacity-thing = x\n");
    const removeButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === "删除",
    );
    await act(async () => {
      removeButtons[0]!.click();
    });
    await clickButton(container, "保存");
    expect(writeGhostyConfig).toHaveBeenCalledWith("opacity-thing = x\n");
  });

  it("shows error when write fails", async () => {
    vi.mocked(writeGhostyConfig).mockRejectedValue(new Error("disk full"));
    root = mount(container);
    await clickButton(container, "保存");
    expect(container.textContent).toContain("disk full");
  });

  it("shows empty state with no kv entries", () => {
    root = mount(container, "# only comment\n");
    expect(container.textContent).toContain("暂无配置项");
  });

  it("renders font key with datalist suggestions from store", async () => {
    vi.mocked(listSystemFonts).mockResolvedValue(["Menlo", "JetBrains Mono"]);
    root = mount(container, "font-family = Menlo\n");
    await act(async () => {});
    const input = container.querySelector<HTMLInputElement>('input[list="system-fonts"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Menlo");
    const datalist = container.querySelector<HTMLDataListElement>("#system-fonts");
    expect(datalist).not.toBeNull();
    const options = [...datalist!.querySelectorAll("option")].map((o) => o.value);
    expect(options).toEqual(["Menlo", "JetBrains Mono"]);
  });

  it("saves a manually typed comma-separated font value", async () => {
    root = mount(container, "font-family = Menlo\n");
    const input = container.querySelector<HTMLInputElement>('input[list="system-fonts"]');
    expect(input).not.toBeNull();
    setInputValue(input!, 'Monaco, "PingFang SC"');
    await clickButton(container, "保存");
    expect(writeGhostyConfig).toHaveBeenCalledWith('font-family = Monaco, "PingFang SC"\n');
  });

  it("degrades to plain font input when system font fetch fails", async () => {
    vi.mocked(listSystemFonts).mockRejectedValue(new Error("tauri unavailable"));
    root = mount(container, "font-family = Menlo\n");
    await act(async () => {});
    expect(container.querySelector<HTMLInputElement>('input[list="system-fonts"]')).not.toBeNull();
    expect(container.querySelector("#system-fonts")).not.toBeNull();
    expect(container.querySelectorAll("#system-fonts option")).toHaveLength(0);
    expect(container.textContent).not.toContain("tauri unavailable");
  });

  it("keeps full current value even when not in font list", async () => {
    vi.mocked(listSystemFonts).mockResolvedValue(["Menlo"]);
    root = mount(container, "font-family = SomeCustomFont\n");
    await act(async () => {});
    const input = container.querySelector<HTMLInputElement>('input[list="system-fonts"]');
    expect(input?.value).toBe("SomeCustomFont");
  });

  it("renders font input when adding font-family from key list", async () => {
    root = mount(container, "# only\n");
    setSelectValue(keySelect(container), "font-family");
    const fontInput = container.querySelector<HTMLInputElement>('input[list="system-fonts"]');
    expect(fontInput).not.toBeNull();
    setInputValue(fontInput!, "JetBrains Mono");
    await clickButton(container, "新增");
    expect(container.textContent).toContain("font-family");
    expect(container.querySelectorAll('input[list="system-fonts"]').length).toBeGreaterThan(0);
  });

  it("renders range and number inputs for bounded number key", () => {
    root = mount(container, "background-opacity = 0.5\n");
    const range = rangeInputs(container);
    expect(range).toHaveLength(1);
    expect(range[0]!.value).toBe("0.5");
    expect(range[0]!.min).toBe("0");
    expect(range[0]!.max).toBe("1");
    const number = numberInputs(container).find((i) => i.value === "0.5");
    expect(number).toBeDefined();
  });

  it("dragging range syncs number input and saves", async () => {
    root = mount(container, "background-opacity = 0.5\n");
    const range = rangeInputs(container)[0]!;
    setInputValue(range, "0.8");
    const number = numberInputs(container)[0]!;
    expect(number.value).toBe("0.8");
    await clickButton(container, "保存");
    expect(writeGhostyConfig).toHaveBeenCalledWith("background-opacity = 0.8\n");
  });

  it("falls back to min when bounded number value is empty", () => {
    root = mount(container, "unfocused-split-opacity =\n");
    const range = rangeInputs(container);
    expect(range).toHaveLength(1);
    expect(range[0]!.value).toBe("0.15");
  });

  it("clamps out-of-range bounded number value to max on range", () => {
    root = mount(container, "background-opacity = 2\n");
    const range = rangeInputs(container)[0]!;
    expect(range.value).toBe("1");
  });

  it("clamps invalid bounded number value to min on range", () => {
    root = mount(container, "background-opacity = abc\n");
    const range = rangeInputs(container)[0]!;
    expect(range.value).toBe("0");
  });

  it("keeps plain number input for single-bounded number key", () => {
    root = mount(container, "background-image-opacity = 1.5\n");
    expect(rangeInputs(container)).toHaveLength(0);
    const number = numberInputs(container)[0]!;
    expect(number.value).toBe("1.5");
    expect(number.min).toBe("0");
    expect(number.max).toBe("");
  });

  it("keeps plain number input for unbounded number key", () => {
    root = mount(container, "font-size = 13\n");
    expect(rangeInputs(container)).toHaveLength(0);
    expect(numberInputs(container)[0]!.value).toBe("13");
  });
});
