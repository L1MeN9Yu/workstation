## 1. CI 集成（最重要的 task）

- [x] 1.1 在 `.github/workflows/` 添加 GitHub Actions 工作流
- [x] 1.2 前端 job：`npm ci` → `lint` → `typecheck` → `build`
- [x] 1.3 后端 job：`cargo fmt --check` → `cargo clippy` → `cargo test` → `cargo build`
- [x] 1.4 合并为一个 workflow，main 分支与 PR 均触发
- [x] 1.5 通过 OS matrix 覆盖 Windows / macOS / Linux 三平台（Linux 额外装 Tauri 系统依赖）
- [x] 1.6 推送后验证 CI 在三个平台首次运行通过（6/6 job 全绿）

## 2. 工程初始化

- [x] 2.1 用 create-tauri-app 初始化 Tauri 2 + React + TypeScript + Vite 工程（根目录前端 + `src-tauri/`）
- [x] 2.2 添加 react-router，建立基础路由（/、/cmux、/tools）
- [x] 2.3 添加 Tailwind CSS v4 并接入全局样式
- [x] 2.4 验证 `cargo tauri build` 成功产出应用（dev 等价于可启动；待手动运行确认窗口）

## 3. App Shell

- [x] 3.1 实现侧边导航（应用名 + 模块列表：任务/cmux/工具集）
- [x] 3.2 实现明/暗主题切换并持久化到本地（config-store / localStorage）
- [x] 3.3 内容区按路由渲染模块页面
- [x] 3.4 页面底部展示应用名与版本号（读取 tauri.conf version via `app_version` command）

## 4. Config Store

- [x] 4.1 Rust 侧实现通用配置读写 command（`read_config`/`write_config` 于 config 目录）
- [x] 4.2 确认自定义 command 无需额外 capability 白名单
- [x] 4.3 前端封装 config-store API（读取/写入函数）
- [x] 4.4 用主题偏好设置验证读写闭环（代码路径 + build 验证；运行时点检待 dev 确认）

## 5. Dev Tools Catalog

- [x] 5.1 前端建立工具注册表 `{id, label, component}`，导航与路由由注册表渲染
- [x] 5.2 实现通用工具页容器（含"开发中"占位 `ToolPage`/`ToolPlaceholder`）
- [x] 5.3 实现 base64 编解码示例工具，验证注册表链路

## 6. Cmux Config 占位

- [x] 6.1 添加 cmux 配置模块入口页面与路由
- [x] 6.2 预留 ghosty 配置识别/描述结构（`src/lib/cmuxConfig.ts` 类型与空实现）

## 7. 收尾

- [x] 7.1 补充 README（开发/构建命令、目录结构说明）
- [x] 7.2 运行 `cargo tauri build` 验证可构建
- [x] 7.3 提交变更并推送（PR #1 merged）
