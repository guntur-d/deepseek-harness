# @deepseek-ai/dsh-memory-tool

English | [中文](README.zh.md)

Model-facing consumer over [`ctx.memory`](../memory/README.md): four `memory_*` tools plus a bounded `app:memory` prompt section that renders the workspace's recent memories into every session, so facts saved in one session carry over to the next.

## Config

```ts
interface Config {
  maxContextEntries: number // default 8; memories rendered into the prompt section
  maxListEntries: number    // default 50; memories one list/search call returns
}
```

Both are validated positive integers.

## Tools

| Tool | Purpose |
|---|---|
| `memory_write { text, tags?, importance? }` | Save one important cross-session fact. The description tells the model WHEN to save (durable preferences, non-obvious project facts) and what NOT to save (transient task state). |
| `memory_list { limit? }` | The workspace memories, newest first. |
| `memory_search { query, limit? }` | Keyword match over memory text and tags, newest first. |
| `memory_forget { id }` | Remove one memory by id (ids come from list/search). |

The tools require an owning agent session; the service records `memory/write`/`memory/forget` events and the tool result confirms the outcome. Entries cross the wire as mutable copies with the store's `seq` included.

## Prompt section

`app:memory` (order 50, after the deployment persona) renders up to `maxContextEntries` workspace memories as one line each (`- [importance] text`), newest first, and is empty when the workspace has none. The text is part of the assembled system prompt, so each request's `request/header` records exactly what was injected.

## Model Experience

### Persistent memories

#### What the model sees

The tools and the bounded memory section described above. The model decides what to save; nothing is auto-summarized.

#### Token effect

At most `maxContextEntries` short lines per request (default 8), bounded by the deployment config; list/search results are additionally capped by `maxListEntries`.

#### KV Cache effect

Append-only for the injected section; newly saved memories follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The model drives recall** — saved memories appear in the prompt only through the bounded section or the tools; there is no automatic "relevant memory" retrieval.
- **No UI** — memories are model- and API-visible only; a future GUI could render the `memory/*` session events.
