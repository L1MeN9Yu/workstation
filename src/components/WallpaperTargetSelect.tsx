import type { ApplyWallpaperTarget } from "../lib/wallpaper";

/** 应用目标选择下拉（单次应用临时切换，不影响持久化默认值） */
export function WallpaperTargetSelect({
  value,
  onChange,
  compact = false,
}: {
  value: ApplyWallpaperTarget;
  onChange: (target: ApplyWallpaperTarget) => void;
  compact?: boolean;
}) {
  return (
    <select
      value={value}
      aria-label="应用目标"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as ApplyWallpaperTarget)}
      className={`rounded-md border border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900 ${
        compact ? "px-1 py-0.5 text-xs" : "px-2 py-1 text-sm"
      }`}
    >
      <option value="cmux">cmux</option>
      <option value="iterm2">iTerm2</option>
    </select>
  );
}
