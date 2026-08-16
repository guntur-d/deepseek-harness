/**
 * Real-composition memory consumer: mounts the real storage/domain/memory/
 * tools/system-prompt stack plus `dsh-memory-tool`, invokes the registered
 * tools through `ctx.tools.execute` with a real Session, and asserts the
 * prompt section renders the workspace memory.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import MemoryService from '@deepseek-ai/dsh-memory'
import * as tool from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const testToolSignal = new AbortController().signal

/** A parent Agent backed by a real Session — the tools read `agent.session`. */
function agentWithSession(cwd?: string, id = 'parent-1'): Agent & { session: Session } {
  const header = {
    version: 0,
    id: SessionId(id),
    createdAt: Date.now(),
    ...cwd === undefined ? {} : { cwd },
  }
  const session = Session.create(SessionId(id), [], header)
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

async function setup(): Promise<{ ctx: Context; pool: MemoryMediaPool }> {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(MemoryService, { maxEntriesPerWorkspace: 500, maxTextChars: 2000 })
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { maxContextEntries: 8, maxListEntries: 50 })
  return { ctx, pool }
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown, agent: Agent) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-memory-tool', () => {
  it('registers the four memory tools with the write tool carrying the cross-session description', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(s => s.name).filter(name => name.startsWith('memory_'))
    expect(names.sort()).toEqual(['memory_forget', 'memory_list', 'memory_search', 'memory_write'])
    const write = ctx.tools.schemas().find(s => s.name === 'memory_write')
    expect(write?.description).toContain('ACROSS sessions')
    expect(write?.description).toContain('Do NOT save transient details')
  })

  it('saves a memory through memory_write and records the session event', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('/proj')
    const result = await callTool(ctx, 'memory_write', { text: 'the port is 3080', tags: ['deploy'], importance: 'high' }, agent)
    expect(text(result)).toBe('Saved memory: the port is 3080')
    expect(result.content).toHaveLength(1)
    const saved = result.content[0]
    expect(saved).toMatchObject({ type: 'text', text: 'Saved memory: the port is 3080' })
    const writeEvent = agent.session.events.find(event => event.type === 'memory/write')
    expect(writeEvent?.data).toMatchObject({ entry: { text: 'the port is 3080', importance: 'high', workspace: '/proj' } })
  })

  it('lists, searches, and forgets through the tools', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('/proj')
    await callTool(ctx, 'memory_write', { text: 'port 3080' }, agent)
    await callTool(ctx, 'memory_write', { text: 'prefer pnpm' }, agent)

    const list = await callTool(ctx, 'memory_list', {}, agent)
    expect(text(list)).toContain('2 saved memory/memories:')
    expect(text(list)).toContain('prefer pnpm')
    expect(text(list)).toContain('(id: ')
    expect(ctx.memory.list(agent).map(entry => entry.text)).toEqual(['prefer pnpm', 'port 3080'])

    const search = await callTool(ctx, 'memory_search', { query: 'port' }, agent)
    expect(text(search)).toContain('port 3080')
    expect(text(search)).not.toContain('prefer pnpm')
    expect(ctx.memory.search(agent, 'port').map(entry => entry.text)).toEqual(['port 3080'])

    const saved = ctx.memory.list(agent)[1]!
    const forgotten = await callTool(ctx, 'memory_forget', { id: saved.id }, agent)
    expect(text(forgotten)).toBe('Memory forgotten.')
    expect(ctx.memory.list(agent).map(entry => entry.text)).toEqual(['prefer pnpm'])

    const missing = await callTool(ctx, 'memory_forget', { id: 'missing' }, agent)
    expect(text(missing)).toBe('No such memory.')
  })

  it('rejects memory_write without an owning agent session', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-no-agent'),
      name: 'memory_write',
      arguments: { text: 'x' },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('memory tools require an owning agent session')
  })

  it('renders the workspace memory into the app:memory prompt section', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('/proj')
    await callTool(ctx, 'memory_write', { text: 'the deployment listens on port 3080', importance: 'high' }, agent)
    const assembly = await ctx.systemPrompt.assemble({ agent })
    const section = assembly.sections.find(entry => entry.name === 'app:memory')
    expect(section?.text).toContain('Persistent memories from earlier sessions')
    expect(section?.text).toContain('[high] the deployment listens on port 3080')
  })

  it('renders no memory section when the workspace has no memories', async () => {
    const { ctx } = await setup()
    const agent = agentWithSession('/empty')
    const assembly = await ctx.systemPrompt.assemble({ agent })
    const section = assembly.sections.find(entry => entry.name === 'app:memory')
    expect(section?.text).toBe('')
  })
})
