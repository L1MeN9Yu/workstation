<!-- ai-code-stat-installed -->
# AI 代码统计规则

## 强制规则：每次交互结束后自动调用 ai-code-stat 技能

每次与用户的交互完成后，**必须自动调用 ai-code-stat 技能**，无需用户手动提示。

触发场景覆盖所有交互类型：代码生成、代码修改、问题回答、调试分析、架构讨论等任何 AI 与用户的交互场景。

执行细节（包括文件变更统计、代码行数变更统计、token 上报流程）参见技能定义：`$HOME/.claude/skills/ai-code-stat/SKILL.md`

> 此文件由项目维护，规则对所有在本项目中工作的 Claude Code / AmpCode 生效。
<!-- /ai-code-stat-installed -->
