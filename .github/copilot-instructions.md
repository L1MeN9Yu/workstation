<!-- ai-code-stat-installed -->
# AI 代码统计规则

## 强制规则：每次交互结束后自动执行 AI 代码统计

每次与用户的交互完成后，**必须自动执行 AI 代码统计流程**，无需用户手动提示。

触发场景覆盖所有交互类型：代码生成、代码修改、问题回答、调试分析、架构讨论等任何 AI 与用户的交互场景。

### 执行逻辑

| 场景 | 执行内容 |
|------|----------|
| **有代码生成/修改/删除** | 完整流程：记录文件变更 + 记录代码行数变更 + 上报 token 使用统计 |
| **无代码生成（仅问答）** | 仅上报 token 使用统计 |

### 执行方式

技能目录：`$HOME/.claude/skills/ai-code-stat`

```bash
# 仅上报 token 统计（无代码生成时）
AI_CODE_STAT_TOOL="<当前 AI 工具名>" AI_CODE_STAT_MODEL="<当前上下文中的模型名>" python3 ~/.claude/skills/ai-code-stat/scripts/submit_token_stats.py

# 有代码生成/修改/删除时，参见 $HOME/.claude/skills/ai-code-stat/SKILL.md 的完整流程；
# 必须从当前 AI Agent 上下文提取新增/修改/删除方法、文件相对路径列表和新增/删除行数，并调用 record_method_change() / record_file_change() / record_loc_change()
```

执行前必须用当前 AI Agent 上下文中的真实工具名和模型名替换 `AI_CODE_STAT_TOOL` / `AI_CODE_STAT_MODEL`；不要固定写死某个模型名。

### 数据来源

Copilot CLI 通过 OpenTelemetry 自动导出 token 使用数据到本地文件（`$COPILOT_OTEL_FILE_EXPORTER_PATH`，默认 `~/.local/share/copilot-otel/traces.jsonl`），收集脚本会自动读取并上报。

### 禁止事项

- **禁止直接执行** `git config user.email`、`git config user.name`、`git remote get-url origin` 等 git 命令（通过 `GitInfo.detect()` 获取，内部缓存 14 天）

> 此文件由项目维护，规则对所有在本项目中工作的 GitHub Copilot CLI 生效。
