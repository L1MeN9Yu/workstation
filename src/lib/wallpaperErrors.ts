/** 图源搜索失败的错误分类，用于给出针对性提示 */
export type SearchErrorKind =
  | "network"
  | "http429"
  | "http4xx"
  | "http5xx"
  | "parse"
  | "unknown";

const HTTP_RE = /request failed with HTTP (\d{3})/;

/**
 * 按后端错误字符串归类：
 * - `xxx response parse failed: ...` → parse
 * - `xxx request failed with HTTP <code>` → http429/http4xx/http5xx
 * - `xxx request failed: <reqwest error>` → network（连接/代理/DNS/超时）
 * - 其他 → unknown
 */
export function classifySearchError(message: string): SearchErrorKind {
  if (/response parse failed/.test(message)) {
    return "parse";
  }
  const http = HTTP_RE.exec(message);
  if (http) {
    const code = Number(http[1]);
    if (code === 429) return "http429";
    if (code >= 400 && code < 500) return "http4xx";
    if (code >= 500) return "http5xx";
  }
  if (/request failed/.test(message)) {
    return "network";
  }
  return "unknown";
}

/** 根据错误分类生成面向用户的提示文案 */
export function describeSearchError(source: string, message: string): string {
  switch (classifySearchError(message)) {
    case "network":
      return `图源 ${source} 连接失败，请检查网络或代理设置：${message}`;
    case "http429":
      return `图源 ${source} 请求过于频繁（HTTP 429），请稍后重试`;
    case "http4xx":
      return `图源 ${source} 请求被拒绝（HTTP 4xx），可能需要登录或配置 API Key：${message}`;
    case "http5xx":
      return `图源 ${source} 服务端错误（HTTP 5xx），请稍后重试：${message}`;
    case "parse":
      return `图源 ${source} 返回数据解析失败：${message}`;
    case "unknown":
      return `图源 ${source} 搜索失败：${message}`;
  }
}
