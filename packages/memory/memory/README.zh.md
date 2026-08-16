# @deepseek-ai/dsh-memory

[English](README.md) | 中文

跨会话持久记忆（`ctx.memory`）：按工作区隔离的持久事实库，agent 选择记住的事实会在同一工作区的后续会话中延续。持久化与校验走 [storage-domain](../../storage/storage-domain/README.md) seam：provider 在部署路由的后端（`json` 或 `sqlite`）上打开 `memory` domain，每次 save/forget 也会向所属会话日志追加 `memory/write`/`memory/forget` 事件，使每个会话日志与跨会话存储保持一致。

## 配置

```ts
interface Config {
  maxEntriesPerWorkspace: number // default 500; the oldest are evicted past it
  maxTextChars: number           // default 2000; longer saves are refused
}
```

两者都是经过校验的正整数。存储后端路由由 `dsh-storage-domain` 配置决定（`routes` 中的 `memory` domain 名，否则用其默认 `backend`）。

## 服务约定

- `save(agent, input)` 在调用者工作区（`agent.session.header.cwd`，无 cwd 的会话共享 `<no-cwd>` 作用域）记住一个事实，记录 `memory/write`，返回持久条目。文本会 trim，必须非空且在 `maxTextChars` 内；tags 会 trim、小写、去重。超出每工作区上限后逐出最旧条目。条目携带单调 `seq`（写链上的原子计数器），即使墙钟时间戳相同排序也确定。
- `list(agent, { limit? })` 返回工作区记忆，最新在前（同步，来自 domain 权威的内存态）。
- `search(agent, query)` 对记忆文本与 tags 做大小写不敏感匹配，最新在前；空查询不匹配任何条目。
- `forget(agent, id)` 删除一条记忆；属于其他工作区的 id 会被拒绝，删除会记录 `memory/forget`。

## 模型体验

### 持久记忆

#### 模型看到什么

本包不直接向模型暴露任何东西——它不注册工具、不注入提示词。模型可见的表层（`memory_*` 工具与 `app:memory` 提示段落）属于 [`dsh-memory-tool`](../memory-tool/README.md)；记忆文本只通过该消费方到达模型。

#### Token 效应

本包为零。注入的记忆由消费方的 `maxContextEntries` 限制；本服务存储完整文本而不把它复制进请求。

#### KV Cache 效应

独立：存储写入从不触碰请求前缀，因此这里不会使 provider 缓存复用失效。

## 已知限制与后续工作

- **`<no-cwd>` 会话共享一个作用域**——没有工作目录的会话读写同一个匿名工作区；未来的 provider 可以改为按项目根目录划分。
- **存储是权威，而非日志**——即使会话日志中的 `memory/*` 事件仍在，存储介质丢失也会丢失记忆；适用 domain 后端的持久性保证。
