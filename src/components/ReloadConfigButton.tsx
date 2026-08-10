import { useState } from "react";
import {
  reloadCmuxConfig,
  reloadStatusMessage,
  type CmuxReloadResult,
} from "../lib/cmuxConfig";

export default function ReloadConfigButton() {
  const [reloading, setReloading] = useState(false);
  const [result, setResult] = useState<CmuxReloadResult | null>(null);

  async function handleReload() {
    setReloading(true);
    setResult(null);
    try {
      const r = await reloadCmuxConfig();
      setResult(r);
    } catch (e) {
      setResult({ status: "failed", message: String(e) });
    } finally {
      setReloading(false);
    }
  }

  const success = result?.status === "success";

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleReload}
        disabled={reloading}
        className="rounded-md bg-gray-200 px-4 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
      >
        {reloading ? "重载中..." : "重新加载配置"}
      </button>
      {result && (
        <span
          className={`text-sm ${
            success
              ? "text-green-600 dark:text-green-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {reloadStatusMessage(result)}
        </span>
      )}
    </div>
  );
}
