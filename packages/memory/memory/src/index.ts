/**
 * Persistent cross-session memory (`ctx.memory`): a workspace-scoped durable
 * store of facts an agent chose to remember, so a later session in the same
 * workspace starts with them. Durability and validation ride the storage
 * domain seam (`ctx.storageDomain`, `memory` domain); the session log records
 * every save/forget as a `memory/*` event, keeping the per-session log
 * consistent with the cross-session store.
 * @module @deepseek-ai/dsh-memory
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { memoryDomainSpec, type MemoryRecord } from './domain.ts'
import { MemoryId, type MemoryEntry, type MemoryEntryInput } from './types.ts'

export { MemoryId, type MemoryEntry, type MemoryEntryInput, type MemoryImportance } from './types.ts'
export { memoryDomainSpec, memoryEntrySchema, type MemoryRecord } from './domain.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

/** Stable Cordis plugin name. */
export const name = 'memory'

/** Default bound on entries per workspace; the oldest are evicted past it. */
const DEFAULT_MAX_ENTRIES_PER_WORKSPACE = 500
/** Default bound on one memory's text length. */
const DEFAULT_MAX_TEXT_CHARS = 2000

/** Plugin config: the store's capacity bounds. */
export interface Config {
  /** Maximum stored entries per workspace; the oldest are evicted past it. */
  maxEntriesPerWorkspace: number
  /** Maximum UTF-16 code units of one memory's text; longer saves are refused. */
  maxTextChars: number
}

/** Schemastery configuration for the memory provider. */
export const Config: z<Config> = z.object({
  maxEntriesPerWorkspace: z.number().step(1).min(1).default(DEFAULT_MAX_ENTRIES_PER_WORKSPACE),
  maxTextChars: z.number().step(1).min(1).default(DEFAULT_MAX_TEXT_CHARS),
})

/** Workspace key for a session without a working directory: one shared scope. */
const ANONYMOUS_WORKSPACE = '<no-cwd>'

/** Derive the memory scope key from the owning session's working directory. */
function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? ANONYMOUS_WORKSPACE
}

/** Brand the plain stored record fields at the store boundary. */
function toEntry(record: MemoryRecord): MemoryEntry {
  return {
    id: MemoryId(record.id),
    workspace: record.workspace,
    text: record.text,
    tags: record.tags,
    importance: record.importance,
    seq: record.seq,
    createdAt: record.createdAt,
    sourceSession: SessionId(record.sourceSession),
  }
}

/** Normalize the model-supplied tags: trim, lowercase, dedupe, drop empties. */
function normalizeTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map(tag => tag.trim().toLowerCase()).filter(tag => tag !== ''))]
}

/**
 * The persistent-memory service. Reads are synchronous from the domain's
 * authoritative in-memory state; saves and forgets await durability on the
 * routed storage backend. Every mutation appends the matching `memory/*`
 * event to the owning session's log.
 */
export class MemoryService extends Service {
  static inject = ['storageDomain']
  static Config = Config

  private table?: KvTable<string, MemoryRecord>
  private counters?: KvTable<string, { seq: number }>
  private readonly maxEntriesPerWorkspace: number
  private readonly maxTextChars: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'memory')
    this.maxEntriesPerWorkspace = config.maxEntriesPerWorkspace
    this.maxTextChars = config.maxTextChars
  }

  /** Open the memory domain on its routed backend and own its close. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'memory.domainClose')
    this.table = domain.table('entries')
    this.counters = domain.table('counters')
    if (this.counters.get('save-seq') === undefined) {
      await this.counters.put('save-seq', { seq: 0 })
    }
  }

  private requireTable(): KvTable<string, MemoryRecord> {
    if (this.table === undefined) throw new Error('memory: store not initialized')
    return this.table
  }

  /**
   * Remember one fact in the caller's workspace and record it in the caller's
   * session log. The entry is durable before the promise resolves; past the
   * per-workspace cap the oldest entries are evicted.
   * @param agent - the live agent whose session scope owns the memory.
   * @param input - the fact to remember.
   * @returns the durable entry.
   */
  async save(agent: Agent, input: MemoryEntryInput): Promise<MemoryEntry> {
    const text = input.text.trim()
    if (text === '') throw new Error('memory.save: text must be a non-empty string')
    if (text.length > this.maxTextChars) {
      throw new Error(`memory.save: text exceeds the ${String(this.maxTextChars)} character cap`)
    }
    const table = this.requireTable()
    const seq = await this.mintSeq()
    const entry: MemoryEntry = {
      id: MemoryId(randomUUID()),
      workspace: workspaceOf(agent),
      text,
      tags: normalizeTags(input.tags),
      importance: input.importance ?? 'medium',
      seq,
      createdAt: Date.now(),
      sourceSession: agent.session.id,
    }
    await table.put(entry.id, {
      id: entry.id,
      workspace: entry.workspace,
      text: entry.text,
      tags: [...entry.tags],
      importance: entry.importance,
      seq: entry.seq,
      createdAt: entry.createdAt,
      sourceSession: entry.sourceSession,
    })

    await this.evictOldest(workspaceOf(agent))
    agent.session.append('memory/write', { entry })
    return entry
  }

  /**
   * The caller's workspace memories, newest first.
   * @param agent - the live agent whose session scope owns the memory.
   * @param options - optional `limit` on the returned count.
   * @returns the matching entries, newest first.
   */
  list(agent: Agent, options?: { limit?: number }): readonly MemoryEntry[] {
    const workspace = workspaceOf(agent)
    const limit = options?.limit
    const entries = this.scanWorkspace(workspace).slice(0, limit)
    return entries.map(entry => toEntry(entry))
  }

  /**
   * Case-insensitive substring search over the caller's workspace memories'
   * text and tags, newest first.
   * @param agent - the live agent whose session scope owns the memory.
   * @param query - the search text; an empty query matches nothing.
   * @returns the matching entries, newest first.
   */
  search(agent: Agent, query: string): readonly MemoryEntry[] {
    const needle = query.trim().toLowerCase()
    if (needle === '') return []
    const workspace = workspaceOf(agent)
    const matches = this.scanWorkspace(workspace).filter(record =>
      record.text.toLowerCase().includes(needle)
      || record.tags.some(tag => tag.includes(needle)))
    return matches.map(record => toEntry(record))
  }

  /**
   * Forget one memory in the caller's workspace. A memory belonging to
   * another workspace is refused (the model can only cite ids it was shown).
   * @param agent - the live agent whose session scope owns the memory.
   * @param id - the memory to remove.
   * @returns true when the memory existed and was removed.
   */
  async forget(agent: Agent, id: MemoryId): Promise<boolean> {
    const table = this.requireTable()
    const record = table.get(id)
    if (record === undefined) return false
    if (record.workspace !== workspaceOf(agent)) {
      throw new Error('memory.forget: the entry belongs to another workspace')
    }
    const deleted = await table.delete(id)
    if (deleted) agent.session.append('memory/forget', { id })
    return deleted
  }

  /** Atomically advance the durable save counter on the domain write chain. */
  private async mintSeq(): Promise<number> {
    const counters = this.requireCounters()
    const next = await counters.update('save-seq', current => ({ seq: current.seq + 1 }))
    return next.seq
  }

  private requireCounters(): KvTable<string, { seq: number }> {
    if (this.counters === undefined) throw new Error('memory: store not initialized')
    return this.counters
  }

  /** The caller's workspace records, newest first (the in-memory scan order). */
  private scanWorkspace(workspace: string): MemoryRecord[] {
    const records: MemoryRecord[] = []
    for (const [, record] of this.requireTable().entries()) {
      if (record.workspace === workspace) records.push(record)
    }
    return records.sort((left, right) => right.seq - left.seq)
  }

  /** Evict the oldest workspace records past the per-workspace cap. */
  private async evictOldest(workspace: string): Promise<void> {
    const table = this.requireTable()
    const excess = this.scanWorkspace(workspace).length - this.maxEntriesPerWorkspace
    if (excess <= 0) return
    const victims = this.scanWorkspace(workspace).slice(-excess)
    for (const victim of victims) await table.delete(victim.id)
  }
}

export default MemoryService
