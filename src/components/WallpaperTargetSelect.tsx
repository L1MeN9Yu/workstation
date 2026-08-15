import type { ApplyWallpaperTarget } from "../lib/wallpaper";

/** 应用目标选择下拉（单次应用临时切换，不影响持久化默认值） */
export function WallpaperTargetSelect({
  value,
  onChange,
  compact = false,
  dark = false,
}: {
  value: ApplyWallpaperTarget;
  onChange: (target: ApplyWallpaperTarget) => void;
  compact?: boolean;
  /** 深色工具栏（如预览弹窗底部信息栏）上的高对比度样式 */
  dark?: boolean;
}) {
  return (
    <select
      value={value}
      aria-label="应用目标"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as ApplyWallpaperTarget)}
      className={`rounded-md border ${
        compact ? "px-1 py-0.5 text-xs" : "px-2 py-1 text-sm"
      } ${
        dark
          ? "border-gray-500/60 bg-gray-700/80 text-white hover:bg-gray-600"
          : "border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900"
      }`}
    >
      <option
        value="cmux"
        className={dark ? "bg-gray-900 text-white" : undefined}
      >
        cmux
      </option>
      <option
        value="iterm2"
        className={dark ? "bg-gray-900 text-white" : undefined}
      >
        iTerm2
      </option>
    </select>
  );
}
