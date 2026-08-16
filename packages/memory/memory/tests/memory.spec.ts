/**
 * Memory service over a real in-memory storage domain: save/list/search/
 * forget semantics, workspace isolation, capacity bounds, session events,
 * and the session-attachment invariant.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryService } from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

/** Build one fake agent with an optional workspace and a real event array. */
function agent(cwd?: string, id = 'session-1'): Agent {
  const events: { type: string; data: unknown }[] = []
  return {
    session: {
      id: SessionId(id),
      header: cwd === undefined ? {} : { cwd },
      events,
      append(type: string, data: unknown) {
        events.push({ type, data })
        return { seq: events.length }
      },
    },
  } as unknown as Agent
}

/** Boot the memory service over an in-memory storage backend. */
async function harness(config?: { maxEntriesPerWorkspace?: number; maxTextChars?: number }) {
  const pool = new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(MemoryService, {
    maxEntriesPerWorkspace: config?.maxEntriesPerWorkspace ?? 500,
    maxTextChars: config?.maxTextChars ?? 2000,
  })
  return { ctx, fiber, pool, memory: ctx.memory }
}

describe('memory service', () => {
  it('saves, lists newest-first, searches, and forgets within one workspace', async () => {
    const { ctx, fiber, memory } = await harness()
    const a = agent('/proj')
    const first = await memory.save(a, { text: 'the deployment listens on port 3080', tags: ['deploy', 'PORT'] })
    const second = await memory.save(a, { text: 'prefer pnpm over yarn', importance: 'high' })

    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({
      workspace: '/proj',
      text: 'the deployment listens on port 3080',
      tags: ['deploy', 'port'],
      importance: 'medium',
      sourceSession: 'session-1',
    })

    const listed = memory.list(a)
    expect(listed.map(entry => entry.id)).toEqual([second.id, first.id])
    expect(memory.list(a, { limit: 1 }).map(entry => entry.id)).toEqual([second.id])

    const searched = memory.search(a, 'port')
    expect(searched.map(entry => entry.id)).toEqual([first.id])
    expect(memory.search(a, 'PNPM').map(entry => entry.id)).toEqual([second.id])
    expect(memory.search(a, 'nope')).toEqual([])

    expect(await memory.forget(a, first.id)).toBe(true)
    expect(await memory.forget(a, first.id)).toBe(false)
    expect(memory.list(a).map(entry => entry.id)).toEqual([second.id])
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('isolates workspaces: list, search, and forget are scoped to the caller', async () => {
    const { ctx, fiber, memory } = await harness()
    const a = agent('/proj-a')
    const b = agent('/proj-b')
    const saved = await memory.save(a, { text: 'secret of project a' })

    expect(memory.list(b)).toEqual([])
    expect(memory.search(b, 'secret')).toEqual([])
    await expect(memory.forget(b, saved.id)).rejects.toThrow('another workspace')
    expect(memory.list(a)).toHaveLength(1)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects empty and oversized text and normalizes tags', async () => {
    const { ctx, fiber, memory } = await harness({ maxTextChars: 10 })
    const a = agent('/proj')
    await expect(memory.save(a, { text: '   ' })).rejects.toThrow('non-empty')
    await expect(memory.save(a, { text: 'this text is too long' })).rejects.toThrow('character cap')
    const saved = await memory.save(a, { text: 'ok', tags: ['  A ', 'a', '', 'B'] })
    expect(saved.tags).toEqual(['a', 'b'])
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('evicts the oldest entries past the per-workspace cap', async () => {
    const { ctx, fiber, memory } = await harness({ maxEntriesPerWorkspace: 2 })
    const a = agent('/proj')
    const first = await memory.save(a, { text: 'one' })
    const second = await memory.save(a, { text: 'two' })
    const third = await memory.save(a, { text: 'three' })
    expect(memory.list(a).map(entry => entry.id)).toEqual([third.id, second.id])
    expect(memory.search(a, 'one')).toEqual([])
    expect(await memory.forget(a, first.id)).toBe(false)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('appends memory/write and memory/forget events to the owning session', async () => {
    const { ctx, fiber, memory } = await harness()
    const a = agent('/proj')
    const saved = await memory.save(a, { text: 'remember me' })
    const writeEvent = a.session.events.find(event => event.type === 'memory/write')
    expect(writeEvent).toMatchObject({ data: { entry: { text: 'remember me' } } })
    await memory.forget(a, saved.id)
    const forgetEvent = a.session.events.find(event => event.type === 'memory/forget')
    expect(forgetEvent).toMatchObject({ data: { id: saved.id } })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps sessions without a working directory in one shared workspace', async () => {
    const { ctx, fiber, memory } = await harness()
    const noCwd = agent(undefined)
    const other = agent(undefined, 'session-2')
    await memory.save(noCwd, { text: 'shared by cwd-less sessions' })
    expect(memory.list(other).map(entry => entry.text)).toEqual(['shared by cwd-less sessions'])
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('survives a store reopen (durability across boots)', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness2(pool)
    const a = agent('/proj')
    const saved = await first.memory.save(a, { text: 'durable fact' })
    await first.fiber.dispose()
    await first.ctx.fiber.dispose()

    const second = await harness2(pool)
    const b = agent('/proj', 'session-2')
    expect(second.memory.list(b).map(entry => entry.id)).toEqual([saved.id])
    expect(second.memory.list(b)[0]).toMatchObject({ text: 'durable fact', workspace: '/proj' })
    await second.fiber.dispose()
    await second.ctx.fiber.dispose()
  })
})

/** Boot the memory service over a SHARED in-memory storage backend. */
async function harness2(pool: MemoryMediaPool) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(MemoryService, { maxEntriesPerWorkspace: 500, maxTextChars: 2000 })
  return { ctx, fiber, memory: ctx.memory }
}
