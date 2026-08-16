# memory/ — 持久跨会话记忆

[English](README.md) | 中文

按工作区隔离的持久记忆：agent 选择记住的事实，在同一项目的多个会话间延续。存储走 storage-domain seam（路由到部署的 `json` 或 `sqlite` 后端）；save/forget 也会向所属会话日志追加 `memory/*` 事件。

| 包 | 角色 | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | 记忆服务定义 + 存储 provider | `ctx.memory` |
| [`memory-tool/`](memory-tool/README.md) | 模型可见的 `memory_write`/`memory_list`/`memory_search`/`memory_forget` 工具 + 有界提示注入 | — |

设计理由与模型可见约定见 [持久记忆 Agent Note](../../.agents/notes/implemented/feature/2026-08-14-persistent-cross-session-memory.md)。
