# Persistent cross-session memory

English | [中文](memory.zh.md)

Types shared by the workspace-scoped memory service and its model-facing consumer. The [persistent-memory Agent Note](../../.agents/notes/implemented/feature/2026-08-14-persistent-cross-session-memory.md) owns the store and injection decisions; this page records the exact fields and the service surface from [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts).

## Entries

`MemoryId` is a [branded id](core.md#branded-ids) minted by the service at save. An entry is one durable fact scoped to the workspace of the session that saved it.

```ts type-equiv
/** One durable memory entry, the unit of the cross-session store. */
interface MemoryEntry {
  /** Store key; also the id the model cites to forget the entry. */
  id: MemoryId
  /** Scope key: the owning session's workspace root, so projects never share memory. */
  workspace: string
  /** The remembered fact, as the model wrote it. */
  text: string
  /** Optional lowercase keywords, normalized and deduplicated at save. */
  tags: readonly string[]
  /** Recency/importance weight; defaults to `medium`. */
  importance: MemoryImportance
  /** Monotonic save sequence: the deterministic ordering key (createdAt may tie). */
  seq: number
  /** Wall-clock save time, for ordering and age display. */
  createdAt: number
  /** The session whose agent recorded the entry. */
  sourceSession: SessionId
}
```

```ts type-equiv
/** How much weight a memory carries for recall and injection ordering. */
type MemoryImportance = 'low' | 'medium' | 'high'
```

```ts type-equiv
/** What the model may supply when saving a memory. */
interface MemoryEntryInput {
  /** The fact to remember; trimmed, must be non-empty and within the text cap. */
  text: string
  /** Optional keywords, normalized (trimmed, lowercased, deduplicated). */
  tags?: readonly string[]
  /** Optional importance; defaults to `medium`. */
  importance?: MemoryImportance
}
```

## The service

`ctx.memory` scopes every verb to the caller's live `Agent` session: `save(agent, input)` remembers a fact and records `memory/write`; `list(agent, { limit? })` and `search(agent, query)` read synchronously newest-first; `forget(agent, id)` removes one entry and records `memory/forget`. Reads never touch the model; the model-facing surface (the `memory_*` tools and the `app:memory` prompt section) is owned by [`dsh-memory-tool`](../../packages/memory/memory-tool/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryservice"></a>

### `ctx.memory` — `MemoryService`

The persistent-memory service. Reads are synchronous from the domain's authoritative in-memory state; saves and forgets await durability on the routed storage backend. Every mutation appends the matching `memory/*` event to the owning session's log.

```ts cordis-catalog
/**
 * Remember one fact in the caller's workspace and record it in the caller's
 * session log. The entry is durable before the promise resolves; past the
 * per-workspace cap the oldest entries are evicted.
 * @param agent - the live agent whose session scope owns the memory.
 * @param input - the fact to remember.
 * @returns the durable entry.
 */
async save(agent: Agent, input: MemoryEntryInput): Promise<MemoryEntry>

/**
 * The caller's workspace memories, newest first.
 * @param agent - the live agent whose session scope owns the memory.
 * @param options - optional `limit` on the returned count.
 * @returns the matching entries, newest first.
 */
list(agent: Agent, options?: { limit?: number }): readonly MemoryEntry[]

/**
 * Case-insensitive substring search over the caller's workspace memories'
 * text and tags, newest first.
 * @param agent - the live agent whose session scope owns the memory.
 * @param query - the search text; an empty query matches nothing.
 * @returns the matching entries, newest first.
 */
search(agent: Agent, query: string): readonly MemoryEntry[]

/**
 * Forget one memory in the caller's workspace. A memory belonging to
 * another workspace is refused (the model can only cite ids it was shown).
 * @param agent - the live agent whose session scope owns the memory.
 * @param id - the memory to remove.
 * @returns true when the memory existed and was removed.
 */
async forget(agent: Agent, id: MemoryId): Promise<boolean>
```

Types: [Agent](core.md)

Source: [`packages/memory/memory/src/index.ts:84`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
