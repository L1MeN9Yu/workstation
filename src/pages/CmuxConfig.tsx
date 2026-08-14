import { useEffect, useState } from "react";
import {
  readCmuxConfig,
  readGhostyConfig,
  type CmuxConfigFile,
} from "../lib/cmuxConfig";
import CmuxConfigForm from "../components/CmuxConfigForm";
import GhostyConfigForm from "../components/GhostyConfigForm";

type Tab = "cmux" | "ghosty";

export default function CmuxConfig() {
  const [tab, setTab] = useState<Tab>("cmux");
  const [cmux, setCmux] = useState<CmuxConfigFile | null>(null);
  const [ghosty, setGhosty] = useState<CmuxConfigFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [c, g] = await Promise.all([readCmuxConfig(), readGhostyConfig()]);
        if (cancelled) return;
        setCmux(c);
        setGhosty(g);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = tab === "cmux" ? cmux : ghosty;

  return (
    <div className="w-full px-6 py-6">
      <h2 className="mb-1 text-xl font-semibold">cmux 配置</h2>
      <p className="mb-4 text-sm text-gray-500">
        为 cmux（AI coding 终端）提供图形化配置，把手写配置转为可视化操作。
      </p>

      <div className="mb-4 flex gap-2">
        {(["cmux", "ghosty"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm ${
              tab === t
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            }`}
          >
            {t === "cmux" ? "cmux 配置" : "ghosty 配置"}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          读取失败：{error}
        </div>
      )}

      {active ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="border-b border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700">
            {active.path}
          </div>
          <div className="p-4">
            {active.kind === "cmux" ? (
              <CmuxConfigForm content={active.content} />
            ) : (
              <GhostyConfigForm content={active.content} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          加载中...
        </div>
      )}
    </div>
  );
}
