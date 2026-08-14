# @deepseek-ai/dsh-memory-tool

[English](README.md) | 中文

基于 [`ctx.memory`](../memory/README.md) 的模型可见消费方：四个 `memory_*` 工具，外加一个有界的 `app:memory` 提示段落，把工作区最近的记忆渲染进每个会话，使一个会话中保存的事实延续到下一个会话。

## 配置

```ts
interface Config {
  maxContextEntries: number // default 8; memories rendered into the prompt section
  maxListEntries: number    // default 50; memories one list/search call returns
}
```

两者都是经过校验的正整数。

## 工具

| 工具 | 用途 |
|---|---|
| `memory_write { text, tags?, importance? }` | 保存一条重要的跨会话事实。描述告诉模型何时保存（持久偏好、非显而易见项目事实）以及不要保存什么（瞬态任务状态）。 |
| `memory_list { limit? }` | 工作区记忆，最新在前。 |
| `memory_search { query, limit? }` | 对记忆文本与 tags 做关键字匹配，最新在前。 |
| `memory_forget { id }` | 按 id 删除一条记忆（id 来自 list/search）。 |

工具需要所属 agent 会话；服务记录 `memory/write`/`memory/forget` 事件，工具结果确认结果。条目以包含存储 `seq` 的可变副本跨线传输。

## 提示段落

`app:memory`（order 50，位于部署 persona 之后）把最多 `maxContextEntries` 条工作区记忆渲染为每行一条（`- [importance] text`），最新在前；工作区无记忆时为空。文本是组装后的系统提示的一部分，因此每次请求的 `request/header` 都会记录实际注入的内容。

## 模型体验

### 持久记忆

#### 模型看到什么

上述工具与有界记忆段落。由模型决定保存什么；不会自动摘要。

#### Token 效应

每次请求最多 `maxContextEntries` 行短文本（默认 8），由部署配置限制；list/search 结果额外受 `maxListEntries` 限制。

#### KV Cache 效应

注入段落是追加式的；新保存的记忆跟随可复用请求前缀，不会使现有 KV-cache 条目失效。

## 已知限制与后续工作

- **模型驱动回忆**——保存的记忆只通过有界段落或工具进入提示；没有自动的"相关记忆"检索。
- **没有 UI**——记忆仅对模型与 API 可见；未来的 GUI 可以渲染 `memory/*` 会话事件。
