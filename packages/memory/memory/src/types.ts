/**
 * Pure types of the persistent-memory domain. The ONE home of the
 * {@link MemoryEntry} contract, the `memory/*` session-event merge, and the
 * brands that cross the store boundary — free of host-side value imports
 * except the zero-cost `MemoryId` brand factory.
 * @module @deepseek-ai/dsh-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One durable memory entry id; minted by the service at save. */
export type MemoryId = Branded<'memory-id'>

/**
 * Brand a string as a {@link MemoryId}.
 * @param id - the raw memory id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function MemoryId(id: string): MemoryId {
  return id as MemoryId
}

/** How much weight a memory carries for recall and injection ordering. */
export type MemoryImportance = 'low' | 'medium' | 'high'

/** One durable memory entry, the unit of the cross-session store. */
export interface MemoryEntry {
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

/** What the model may supply when saving a memory. */
export interface MemoryEntryInput {
  /** The fact to remember; trimmed, must be non-empty and within the text cap. */
  text: string
  /** Optional keywords, normalized (trimmed, lowercased, deduplicated). */
  tags?: readonly string[]
  /** Optional importance; defaults to `medium`. */
  importance?: MemoryImportance
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One memory entry durably recorded in the caller's session log. Log-only; never derived history. */
    'memory/write': { entry: MemoryEntry }
    /** One memory entry removed from the caller's session log. Log-only; never derived history. */
    'memory/forget': { id: MemoryId }
  }
}
