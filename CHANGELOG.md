# workstation

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
