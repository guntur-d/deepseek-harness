# Agent Note: 持久跨会话记忆

Status: implemented

[English](2026-08-14-persistent-cross-session-memory.md) | 中文

## 问题

新会话只从工作区指令与当前对话开始：操作者或早期会话建立的持久事实（端口、偏好、非显而易见的项目事实）每次都不得不重新发现或重新说明。按 id 恢复会话只能恢复同一个会话；compaction 只在会话内摘要；`session-reference` 只在被点名时按需回忆其他会话——没有任何机制自动把选定的事实带到后续会话。

## 决策

在能力 seam 之后建立按工作区隔离的记忆存储：`ctx.memory`（Service Definition + provider）把事实持久存储到 storage-domain seam（`memory` domain，`entries` 表按 id 为键，路由到部署的 `json` 或 `sqlite` 后端）；`dsh-memory-tool`（Consumer）暴露 `memory_write`/`memory_list`/`memory_search`/`memory_forget`，并把有界的 `app:memory` 提示段落（order 50，最多 `maxContextEntries` 行）注入同一工作区的每个会话。由模型决定什么值得保存，由 `memory_write` 的描述引导；不做自动摘要。每次 save/forget 也会追加 `memory/write`/`memory/forget` 会话事件，使单会话日志与跨会话存储保持一致。条目携带在 domain 原子写链上铸造的单调 `seq`，即使墙钟时间戳相同，排序与逐出也保持确定。工作区作用域是所属会话的 `cwd`（否则共享一个 `<no-cwd>` 作用域），因此项目之间不会共享记忆。

## 备选方案

**工作区里的普通 `MEMORY.md` 文件。** 否决：多个会话并发追加同一文件会产生竞争并丢失写入，也没有可供搜索或有界注入的结构。storage domain 提供原子写、校验与可替换的后端。

**轮次结束自动摘要。** 否决为默认：每轮摘要都花费 token 且收录噪音。模型驱动工具让操作者的措辞与工具描述决定什么重要；以后可以在不改 seam 的情况下添加摘要 provider。

**默认使用 MCP 后端（MemPalace/Obsidian）。** 否决：外部服务器与嵌入管线对人规模、且 harness 已有原语的存储来说太重。provider seam 为以后接入 MCP provider 留下落点。

**以记录的 `user/message` 上下文注入。** 否决：系统提示段落让记忆在每次请求时保持新鲜，并在每次请求的 `request/header` 中被记录，无需 append/replace 机制即可满足「模型可见⟺已记录」不变量。

## 后果

一个会话中保存的事实通过有界提示段落与工具对同一工作区的后续会话可见。记忆按工作区有界（逐出）与按条目有界（文本上限），两者都是经过校验的配置。存储是跨会话权威；存储介质丢失会丢失记忆，即使各会话的 `memory/*` 事件仍在。没有模型的写入，记忆永远不会被自动注入（首次保存前段落为空）。
