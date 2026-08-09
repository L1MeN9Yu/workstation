## 1. CI 集成（最重要的 task）

- [ ] 1.1 在 `.github/workflows/` 添加 GitHub Actions 工作流
- [ ] 1.2 前端 job：`npm ci` → `lint` → `typecheck` → `build`
- [ ] 1.3 后端 job：`cargo fmt --check` → `cargo clippy` → `cargo test` → `cargo build`
- [ ] 1.4 合并为一个 workflow，main 分支与 PR 均触发
- [ ] 1.5 通过 OS matrix 覆盖 Windows / macOS / Linux 三平台（Linux 额外装 Tauri 系统依赖）
- [ ] 1.6 推送后验证 CI 在三个平台首次运行通过

## 2. 工程初始化

- [ ] 2.1 用 create-tauri-app 初始化 Tauri 2 + React + TypeScript + Vite 工程（根目录前端 + `src-tauri/`）
- [ ] 2.2 添加 react-router，建立基础路由（/、/cmux、/tools）
- [ ] 2.3 添加 Tailwind CSS v4 并接入全局样式
- [ ] 2.4 验证 `cargo tauri dev` 可启动、窗口正常显示

## 3. App Shell

- [ ] 3.1 实现侧边导航（应用名 + 模块列表：任务/cmux/工具集）
- [ ] 3.2 实现明/暗主题切换并持久化到本地
- [ ] 3.3 内容区按路由渲染模块页面
- [ ] 3.4 页面底部展示应用名与版本号（读取 tauri.conf identifier/version）

## 4. Config Store

- [ ] 4.1 Rust 侧实现通用配置读写 command（读取/写入 JSON 配置于 app_config_dir）
- [ ] 4.2 配置 Tauri capabilities 允许前端调用相关 command
- [ ] 4.3 前端封装 config-store API（读取/写入函数）
- [ ] 4.4 用应用偏好设置单测/手动验证读写闭环

## 5. Dev Tools Catalog

- [ ] 5.1 前端建立工具注册表 `{id, label, component}`，导航与路由由注册表渲染
- [ ] 5.2 实现通用工具页容器（含"开发中"占位）
- [ ] 5.3 实现 base64 编解码示例工具，验证注册表链路

## 6. Cmux Config 占位

- [ ] 6.1 添加 cmux 配置模块入口页面与路由
- [ ] 6.2 预留 ghosty 配置识别/描述结构（类型定义与空实现），供后续 change 扩展

## 7. 收尾

- [ ] 7.1 补充 README（开发/构建命令、目录结构说明）
- [ ] 7.2 运行 `cargo tauri build` 验证可构建
- [ ] 7.3 提交变更并推送
