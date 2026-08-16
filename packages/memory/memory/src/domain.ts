/**
 * The durable `memory` domain: one `entries` table keyed by memory id. The
 * schema is the source of truth for the stored record shape; the service
 * brands the plain stored fields (id, sourceSession) at the store boundary.
 * @module @deepseek-ai/dsh-memory/domain
 */

import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'

/** Durable record shape of one memory entry (plain strings; brands live in `MemoryEntry`). */
export const memoryEntrySchema = z.object({
  id: z.string(),
  workspace: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  importance: z.enum(['low', 'medium', 'high']),
  seq: z.number(),
  createdAt: z.number(),
  sourceSession: z.string(),
})

/** The monotonic save-sequence counter record. */
export const memoryCounterSchema = z.object({ seq: z.number() })

/** The stored record type derived from {@link memoryEntrySchema}. */
export type MemoryRecord = z.infer<typeof memoryEntrySchema>

/** Domain declaration opened by the memory provider on its routed backend. */
export const memoryDomainSpec = defineDomain({
  name: 'memory',
  version: 1,
  tables: {
    entries: {
      valueSchema: memoryEntrySchema,
    },
    counters: {
      valueSchema: memoryCounterSchema,
    },
  },
})
