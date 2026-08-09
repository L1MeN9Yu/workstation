import { useMemo, useState } from "react";
import { ToolPage } from "../ToolPage";

export default function Base64Tool() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"encode" | "decode">("encode");

  const output = useMemo(() => {
    try {
      if (mode === "encode") {
        return btoa(unescape(encodeURIComponent(input)));
      }
      return decodeURIComponent(escape(atob(input)));
    } catch {
      return `<无法${mode === "encode" ? "编码" : "解码"}: 输入非法>`;
    }
  }, [input, mode]);

  return (
    <ToolPage title="Base64 编解码" description="支持 UTF-8 文本的 Base64 编码与解码">
      <div className="mb-4 flex gap-2">
        {(["encode", "decode"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 text-sm ${
              mode === m
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            }`}
          >
            {m === "encode" ? "编码" : "解码"}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        placeholder={mode === "encode" ? "输入要编码的文本..." : "输入要解码的 Base64..."}
        className="mb-2 h-32 w-full resize-y rounded-md border border-gray-300 bg-white p-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
      <textarea
        readOnly
        value={output}
        placeholder="结果"
        className="h-32 w-full resize-y rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      />
    </ToolPage>
  );
}
