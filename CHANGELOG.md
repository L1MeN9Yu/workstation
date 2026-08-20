# workstation

## 0.7.0

### Minor Changes

- - 新增壁纸黑名单：按原图 URL 拉黑壁纸，搜索/缩略图快取/下载/预览全面拦截，不再展示被拉黑壁纸且不为其下载缩略图
  - 搜索卡片新增右上角「更多操作」菜单（拉黑、复制原图 URL），预览支持一键拉黑
  - 黑名单管理面板：总数统计、按 URL 关键词搜索、分页展示（每页 20 条）、图源标签 + 缩略图 + URL、移除与清空（二次确认）
  - 黑名单数据持久化迁移至 SQLite（`workstation.db`），旧配置文件启动时一次性导入

## 0.6.0

### Minor Changes

- 壁纸搜索历史与 SQLite 存储基建
  
  - 每个壁纸图源（wallhaven / Danbooru / Safebooru）独立维护搜索历史，持久化到 SQLite（去重置顶、无上限，发起非随机搜索即记录）
  - 搜索框下方常驻「搜索历史」分页区块：8 条/页翻页、点击即回搜、单条删除、清空当前站点
  - 引入项目级 SQLite 存储基建（rusqlite bundled + 迁移执行器），为后续功能复用
  - 修复：iTerm profile 写入不再残留 tmp 中间文件，消除 iTerm 格式错误弹窗
  - 修复：版本同步脚本同时回写 Cargo.toml，界面版本号与实际版本对齐
  - 修复：缩略图后台预取失败时记录具体错误日志，便于排查

## 0.4.0

### Minor Changes

- - 引入 sonner toast 统一全部操作反馈（保存/重载/应用/删除/错误提示统一右上角展示，跟随深浅色）
  - 下沉共享组件：ConfigValueControl / Alert / Button / EmptyState，消除 600+ 行重复
  - 壁纸搜索错误按类型分类提示（网络代理 / 429 限流 / 4xx 认证 / 5xx 服务端 / 解析失败）

## 0.2.0

### Minor Changes

- - 统一版本管理：changesets 自动递增版本、build 号（X.Y.Z+build.n）、版本一致性 CI 检查
  - 全局代理设置：壁纸与更新检查统一走全局代理（含旧壁纸代理迁移）
  - 修复：Tauri 运行时检测改用 __TAURI_INTERNALS__，安装包内更新检查恢复可用
