import { Link } from "react-router-dom";
import { toolRegistry } from "../lib/toolsRegistry";

export default function DevTools() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <h2 className="mb-1 text-xl font-semibold">研发工具集</h2>
      <p className="mb-4 text-sm text-gray-500">
        常用 Web 研发工具集合：base64、加解密、URL encoding、hash、颜色 picker 等。
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {toolRegistry.map((t) => (
          <Link
            key={t.id}
            to={t.path}
            className="rounded-lg border border-gray-200 p-4 transition hover:border-blue-400 hover:shadow dark:border-gray-700"
          >
            <div className="font-medium">{t.label}</div>
            {t.description && (
              <div className="mt-1 text-xs text-gray-500">{t.description}</div>
            )}
          </Link>
        ))}
        {toolRegistry.length === 0 && (
          <div className="text-sm text-gray-400">暂未注册工具。</div>
        )}
      </div>
    </div>
  );
}
