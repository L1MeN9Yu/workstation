import type { KeyboardEvent } from "react";

/** 配置项值控件所需的字段子集（兼容 Iterm2KeySpec / GhostyKeySpec） */
export interface ConfigValueSpec {
  enum?: readonly string[];
  min?: number;
  max?: number;
  placeholder?: string;
}

interface Props {
  spec: ConfigValueSpec | undefined;
  /** 控件类型：enum/bool/yesno/number/color/font/text 等 */
  type: string;
  value: string;
  className: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** 将存储值（如 iTerm2 的 RGB 数组字符串）转换为取色器可用的 #hex，无法转换返回 null */
  colorValueToHex?: (v: string) => string | null;
}

function enumOptions(spec: ConfigValueSpec, current: string): string[] {
  const options = [...(spec.enum ?? [])];
  if (current && !options.includes(current)) options.push(current);
  return options;
}

/**
 * 配置表单的共享值控件：按类型渲染下拉（enum/bool/yesno）、
 * 滑块+数字输入（number 带范围）、取色器（color）、字体候选（font）或普通输入。
 */
export default function ConfigValueControl({
  spec,
  type,
  value,
  className,
  onChange,
  onKeyDown,
  colorValueToHex,
}: Props) {
  if (type === "enum" && spec?.enum) {
    return (
      <select className={className} value={value} onChange={(ev) => onChange(ev.target.value)}>
        {enumOptions(spec, value).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (type === "bool") {
    return (
      <select className={className} value={value} onChange={(ev) => onChange(ev.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (type === "yesno") {
    return (
      <select className={className} value={value} onChange={(ev) => onChange(ev.target.value)}>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  if (type === "number") {
    if (spec?.min !== undefined && spec.max !== undefined) {
      const numeric = Number(value);
      const rangeValue =
        numeric >= spec.min && numeric <= spec.max
          ? numeric
          : numeric > spec.max
            ? spec.max
            : spec.min;
      return (
        <div className="flex flex-1 items-center gap-2">
          <input
            type="range"
            className="min-w-0 flex-1 cursor-pointer"
            min={spec.min}
            max={spec.max}
            step={0.01}
            value={rangeValue}
            onChange={(ev) => onChange(ev.target.value)}
          />
          <input
            type="number"
            className="w-24 shrink-0 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            value={value}
            min={spec.min}
            max={spec.max}
            onChange={(ev) => onChange(ev.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      );
    }
    return (
      <input
        type="number"
        className={className}
        value={value}
        min={spec?.min}
        max={spec?.max}
        onChange={(ev) => onChange(ev.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  }
  if (type === "font") {
    return (
      <input
        list="system-fonts"
        className={className}
        value={value}
        placeholder={spec?.placeholder}
        onChange={(ev) => onChange(ev.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  }
  if (type === "color") {
    const converted = colorValueToHex?.(value);
    const pickerValue =
      converted ?? (/^#/.test(value.trim()) ? value.trim() : "#000000");
    return (
      <div className="flex flex-1 items-center gap-2">
        <input
          type="color"
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
          value={pickerValue}
          onChange={(ev) => onChange(ev.target.value)}
        />
        <input
          className={className}
          value={value}
          placeholder={spec?.placeholder}
          onChange={(ev) => onChange(ev.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }
  return (
    <input
      className={className}
      value={value}
      placeholder={spec?.placeholder}
      onChange={(ev) => onChange(ev.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}
