import { listGhostyConfigs } from "../lib/cmuxConfig";

export default function CmuxConfig() {
  const configs = listGhostyConfigs();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <h2 className="mb-1 text-xl font-semibold">cmux 配置</h2>
      <p className="mb-4 text-sm text-gray-500">
        为 cmux（AI coding 终端）提供图形化配置，重点是把 ghosty 手写配置转为可视化操作（模块骨架建设中）。
      </p>
      <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-2 text-sm font-medium">ghosty 配置</h3>
        {configs.length === 0 ? (
          <p className="text-sm text-gray-400">
            暂未发现 ghosty 配置文件。读取/解析能力将在后续版本提供。
          </p>
        ) : (
          <ul>
            {configs.map((c) => (
              <li key={c.id}>{c.meta.label}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
