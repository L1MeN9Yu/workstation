import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function OpenLogDirButton() {
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  async function handleOpen() {
    setOpening(true);
    setResult(null);
    try {
      await invoke("open_log_dir");
      setResult({ ok: true, message: "已打开日志目录" });
    } catch (e) {
      setResult({ ok: false, message: String(e) });
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => void handleOpen()}
        disabled={opening}
        className="rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
      >
        {opening ? "打开中..." : "打开日志目录"}
      </button>
      {result && (
        <span
          className={`text-sm ${
            result.ok
              ? "text-green-600 dark:text-green-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {result.message}
        </span>
      )}
    </div>
  );
}
