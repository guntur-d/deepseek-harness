# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

Persistent cross-session memory (`ctx.memory`): a workspace-scoped durable store of facts an agent chose to remember, so a later session in the same workspace starts with them. Durability and validation ride the [storage-domain](../../storage/storage-domain/README.md) seam: the provider opens the `memory` domain on the deployment's routed backend (`json` or `sqlite`), and every save/forget also appends a `memory/write`/`memory/forget` event to the owning session's log, keeping each session log consistent with the cross-session store.

## Config

```ts
interface Config {
  maxEntriesPerWorkspace: number // default 500; the oldest are evicted past it
  maxTextChars: number           // default 2000; longer saves are refused
}
```

Both are validated positive integers. The storage backend route is decided by `dsh-storage-domain` config (the `memory` domain name in `routes`, else its default `backend`).

## Service contract

- `save(agent, input)` remembers one fact in the caller's workspace (`agent.session.header.cwd`, or one shared `<no-cwd>` scope for cwd-less sessions), records `memory/write`, and returns the durable entry. Text is trimmed, must be non-empty and within `maxTextChars`; tags are trimmed, lowercased, deduplicated. Past the per-workspace cap the oldest entries are evicted. Entries carry a monotonic `seq` (an atomic write-chain counter) so ordering is deterministic even when wall-clock timestamps tie.
- `list(agent, { limit? })` returns the workspace memories newest-first (synchronous, from the domain's authoritative in-memory state).
- `search(agent, query)` case-insensitively matches memory text and tags, newest-first; an empty query matches nothing.
- `forget(agent, id)` removes one memory; an id belonging to another workspace is refused, and the removal records `memory/forget`.

## Model Experience

### Persistent memories

#### What the model sees

Nothing directly — the service registers no tools and injects no prompts. The model-facing surface (the `memory_*` tools and the `app:memory` prompt section) belongs to [`dsh-memory-tool`](../memory-tool/README.md); the memory text reaches a model only through that consumer.

#### Token effect

Zero from this package. The injected memory is bounded by the consumer's `maxContextEntries`; this service stores full text without duplicating it into requests.

#### KV Cache effect

Independent: store writes never touch request prefixes, so nothing here invalidates provider cache reuse.

## Known Limitations and Deferred Work

- **`<no-cwd>` sessions share one scope** — sessions created without a working directory all read and write the same anonymous workspace; a future provider could scope by project root instead.
- **The store is the authority, not the logs** — a lost storage medium loses memory even though the per-session `memory/*` events survive in session logs; the domain backend's durability guarantees apply.
