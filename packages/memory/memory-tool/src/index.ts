/**
 * Model-facing memory consumer: `memory_write`, `memory_list`,
 * `memory_search`, and `memory_forget` tools over `ctx.memory`, plus a
 * bounded `app:memory` prompt section rendering the workspace's recent
 * memories into every session. Saves and forgets also record `memory/*`
 * events in the owning session's log (the service does the durable store
 * write; the tool is a thin presenter).
 * @module @deepseek-ai/dsh-memory-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { MemoryId, type MemoryEntry } from '@deepseek-ai/dsh-memory'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Stable Cordis plugin name. */
export const name = 'memory-tool'

/** Services required before the tools and prompt section can register. */
export const inject = ['tools', 'memory', 'systemPrompt']

/** Plugin config: the model-facing presentation bounds. */
export interface Config {
  /** Maximum memories rendered into the `app:memory` prompt section. */
  maxContextEntries: number
  /** Maximum memories one `memory_list`/`memory_search` call returns. */
  maxListEntries: number
}

/** Schemastery configuration for the memory consumer. */
export const Config: z<Config> = z.object({
  maxContextEntries: z.number().step(1).min(1).default(8),
  maxListEntries: z.number().step(1).min(1).default(50),
})

/** Value schema of one memory entry, shared by the tool output contracts. */
const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    workspace: { type: 'string', required: true },
    text: { type: 'string', required: true },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    importance: { type: 'string', required: true, enum: ['low', 'medium', 'high'] },
    seq: { type: 'integer', required: true },
    createdAt: { type: 'integer', required: true },
    sourceSession: { type: 'string', required: true },
  },
} satisfies import('@deepseek-ai/dsh-tools').ValueSchemaSpec

/** The model-facing write description: WHEN saving is appropriate. */
const WRITE_DESCRIPTION = 'Save one important fact about the user, the project, or the environment '
  + 'that should be remembered ACROSS sessions in this workspace. Use it when the user states a durable '
  + 'preference, you learn a non-obvious project fact, or an earlier session\'s context would save future '
  + 'work. Keep each memory short and self-contained (one fact per call). Do NOT save transient details '
  + 'like current task state, file contents, or error messages — those belong in the conversation or todos.'

/** A memory entry with a mutable tags copy, as the wire contract declares it. */
type WireEntry = MemoryEntry & { tags: string[] }

/** Owned mutable copy of one entry for the tool's wire contract. */
function wireEntry(entry: MemoryEntry): WireEntry {
  return { ...entry, tags: [...entry.tags] }
}

/** Owned mutable copies of a readonly snapshot for the tool's wire contract. */
function wireEntries(entries: readonly MemoryEntry[]): WireEntry[] {
  return entries.map(wireEntry)
}

/** Require the owning agent session every memory tool needs. */
function requireAgent(exec: { agent?: import('@deepseek-ai/dsh-agent').Agent }): import('@deepseek-ai/dsh-agent').Agent {
  if (exec.agent === undefined) throw new Error('memory tools require an owning agent session')
  return exec.agent
}

/** The generic call card every memory tool presents. */
function memoryCallView(title: string): (args: unknown) => import('@deepseek-ai/dsh-tools').ToolCallView {
  return args => ({ card: 'generic', title, kind: 'other', rawInput: args })
}

/** Render the model-facing result text of list/search, including entry ids for forget. */
function renderEntries(entries: readonly { id: string; text: string; importance: string }[]): string {
  if (entries.length === 0) return 'No saved memories.'
  const lines = entries.map((entry, index) =>
    `${String(index + 1)}. [${entry.importance}] ${entry.text} (id: ${entry.id})`)
  return `${String(entries.length)} saved memory/memories:\n${lines.join('\n')}`
}

/** Render the injected prompt section from the bounded recent entries. */
function renderMemorySection(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map(entry => `- [${entry.importance}] ${entry.text}`)
  return 'Persistent memories from earlier sessions in this workspace (most recent first; '
    + 'use memory_search or memory_list for details):\n' + lines.join('\n')
}

/**
 * Register the memory tools and the `app:memory` prompt section.
 * @param ctx - registrant context carrying the tool registry, memory service, and prompt registry.
 * @param config - deployment presentation bounds.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'memory_write',
    description: WRITE_DESCRIPTION,
    parameters: {
      text: { type: 'string', required: true, description: 'The fact to remember, short and self-contained.' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional lowercase keywords for later search.',
      },
      importance: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'How important this memory is for future sessions; default medium.',
      },
    },
    output: {
      schema: ENTRY_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: `Saved memory: ${value.text}` }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const entry = await ctx.memory.save(agent, {
        text: args.text,
        ...args.tags !== undefined && { tags: args.tags },
        ...args.importance !== undefined && { importance: args.importance },
      })
      return wireEntry(entry)
    },
    presentCall: memoryCallView('Save persistent memory'),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: 'List the saved persistent memories for this workspace, newest first.',
    parameters: {
      limit: {
        type: 'integer',
        description: 'Maximum memories to return; deployment default when omitted.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { entries: { type: 'array', required: true, items: ENTRY_SCHEMA } },
      },
      render: (_args, value) => [
        { type: 'text', text: renderEntries(value.entries) },
      ],
    },
    execute(args, exec) {
      const agent = requireAgent(exec)
      return Promise.resolve({ entries: wireEntries(ctx.memory.list(agent, { limit: args.limit ?? config.maxListEntries })) })
    },
    presentCall: memoryCallView('List persistent memories'),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search the saved persistent memories for this workspace by keyword, newest first.',
    parameters: {
      query: { type: 'string', required: true, description: 'The keyword or phrase to match against memory text and tags.' },
      limit: {
        type: 'integer',
        description: 'Maximum memories to return; deployment default when omitted.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { entries: { type: 'array', required: true, items: ENTRY_SCHEMA } },
      },
      render: (_args, value) => [
        { type: 'text', text: renderEntries(value.entries) },
      ],
    },
    execute(args, exec) {
      const agent = requireAgent(exec)
      const entries = ctx.memory.search(agent, args.query)
      return Promise.resolve({ entries: wireEntries(entries.slice(0, args.limit ?? config.maxListEntries)) })
    },
    presentCall: memoryCallView('Search persistent memories'),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: 'Remove one saved persistent memory by id. Use an id from memory_list or memory_search.',
    parameters: {
      id: { type: 'string', required: true, description: 'The memory id to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { forgotten: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [
        { type: 'text', text: value.forgotten ? 'Memory forgotten.' : 'No such memory.' },
      ],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      return { forgotten: await ctx.memory.forget(agent, MemoryId(args.id)) }
    },
    presentCall: memoryCallView('Forget persistent memory'),
  }))

  ctx.systemPrompt.section({
    name: 'app:memory',
    order: 50,
    text: (context) => {
      const agent = context.agent
      if (agent === undefined) return ''
      return renderMemorySection(ctx.memory.list(agent, { limit: config.maxContextEntries }))
    },
  })
}
