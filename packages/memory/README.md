# memory/ — persistent cross-session memory

English | [中文](README.zh.md)

Workspace-scoped durable memory: facts an agent chose to remember, carried across sessions in the same project. The store rides the storage-domain seam (routed to the deployment's `json` or `sqlite` backend); saves and forgets also append `memory/*` events to the owning session's log.

| Package | Role | ctx key |
|---|---|---|
| [`memory/`](memory/README.md) | Memory service definition + store provider | `ctx.memory` |
| [`memory-tool/`](memory-tool/README.md) | Model-facing `memory_write`/`memory_list`/`memory_search`/`memory_forget` tools + bounded prompt injection | — |

Design rationale and the model-facing contract live in the [persistent-memory Agent Note](../../.agents/notes/implemented/feature/2026-08-14-persistent-cross-session-memory.md).
