import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ConfigValueControl, {
  type ConfigValueSpec,
} from "./ConfigValueControl";

interface RenderOptions {
  spec?: ConfigValueSpec;
  type?: string;
  value?: string;
  onChange?: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  colorValueToHex?: (v: string) => string;
}

function setup(
  container: HTMLElement,
  options: RenderOptions = {},
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ConfigValueControl
        spec={options.spec}
        type={options.type ?? "text"}
        value={options.value ?? ""}
        className="w-full"
        onChange={options.onChange ?? vi.fn()}
        onKeyDown={options.onKeyDown}
        colorValueToHex={options.colorValueToHex}
      />,
    );
  });
  return root;
}

describe("ConfigValueControl", () => {
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

  it("renders an enum select and appends the current out-of-enum value", () => {
    root = setup(container, {
      type: "enum",
      spec: { enum: ["box", "bar"] },
      value: "box",
    });
    const select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("box");
    expect([...select!.options].map((o) => o.value)).toEqual(["box", "bar"]);

    root.unmount();
    root = setup(container, {
      type: "enum",
      spec: { enum: ["box", "bar"] },
      value: "custom",
    });
    const select2 = container.querySelector<HTMLSelectElement>("select");
    expect([...select2!.options].map((o) => o.value)).toEqual([
      "box",
      "bar",
      "custom",
    ]);
  });

  it("renders a bool select with true/false options", () => {
    root = setup(container, { type: "bool", value: "true" });
    const select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("true");
    expect([...select!.options].map((o) => o.value)).toEqual(["true", "false"]);
  });

  it("renders a yesno select with Yes/No options", () => {
    root = setup(container, { type: "yesno", value: "Yes" });
    const select = container.querySelector<HTMLSelectElement>("select");
    expect([...select!.options].map((o) => o.value)).toEqual(["Yes", "No"]);
  });

  it("renders range + number for a number with min/max and clamps the range", () => {
    const onChange = vi.fn();
    root = setup(container, {
      type: "number",
      spec: { min: 0, max: 30 },
      value: "15",
      onChange,
    });
    const range = container.querySelector<HTMLInputElement>('input[type="range"]');
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(range).not.toBeNull();
    expect(range?.min).toBe("0");
    expect(range?.max).toBe("30");
    expect(range?.value).toBe("15");
    expect(number?.value).toBe("15");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(number, "18");
      number!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("18");
  });

  it("clamps an out-of-range value on the slider", () => {
    root = setup(container, {
      type: "number",
      spec: { min: 0, max: 30 },
      value: "99",
    });
    const range = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(range?.value).toBe("30");

    root.unmount();
    root = setup(container, {
      type: "number",
      spec: { min: 0, max: 30 },
      value: "-5",
    });
    const range2 = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(range2?.value).toBe("0");
  });

  it("renders a plain number input without a range", () => {
    root = setup(container, { type: "number", value: "7" });
    const input = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(input).not.toBeNull();
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(input?.value).toBe("7");
  });

  it("renders a font input bound to the system-fonts datalist", () => {
    root = setup(container, { type: "font", spec: { placeholder: "字体" } });
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.getAttribute("list")).toBe("system-fonts");
    expect(input?.placeholder).toBe("字体");
  });

  it("renders a color picker plus text input with a hex fallback", () => {
    root = setup(container, {
      type: "color",
      value: "[0.33, 0.13, 0.14, 1]",
      colorValueToHex: () => "#542124",
    });
    const picker = container.querySelector<HTMLInputElement>('input[type="color"]');
    expect(picker?.value).toBe("#542124");
    const text = container.querySelector<HTMLInputElement>('input:not([type="color"])');
    expect(text?.value).toBe("[0.33, 0.13, 0.14, 1]");
  });

  it("treats a non-hex color value without converter as black", () => {
    root = setup(container, { type: "color", value: "not-a-color" });
    const picker = container.querySelector<HTMLInputElement>('input[type="color"]');
    expect(picker?.value).toBe("#000000");
  });

  it("renders a plain text input for any other type", () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    root = setup(container, {
      type: "text",
      value: "hello",
      spec: { placeholder: "占位" },
      onChange,
      onKeyDown,
    });
    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("hello");
    expect(input?.placeholder).toBe("占位");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "world");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("world");
    act(() => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
