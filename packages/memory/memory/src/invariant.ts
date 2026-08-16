/**
 * Package-owned durable memory-event invariants: each `memory/write` event
 * in an attached session must carry a well-formed entry and each
 * `memory/forget` a non-empty id. The cross-session store is not visible
 * here — a forget may reference an entry recorded in another session — so the
 * check is per-event shape, not store membership.
 * @module @deepseek-ai/dsh-memory/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { memoryEntrySchema } from './domain.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory'

/** Cordis companion plugin name. */
export const name = 'memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the saved-entry shape, applied to one event. */
function checkEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'memory/write') {
    const entry = event.data.entry
    const parsed = memoryEntrySchema.safeParse({
      id: entry.id,
      workspace: entry.workspace,
      text: entry.text,
      tags: [...entry.tags],
      importance: entry.importance,
      createdAt: entry.createdAt,
      sourceSession: entry.sourceSession,
    })
    if (!parsed.success || entry.id === '') {
      fail(`session event ${event.seq} violates the durable memory stream: memory/write entry must be well-formed`)
    }
    return
  }
  if (event.type === 'memory/forget' && event.data.id === '') {
    fail(`session event ${event.seq} violates the durable memory stream: memory/forget id must be non-empty`)
  }
}

/** Install a per-event shape check over every attached session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (event: SessionEvent): void => { checkEvent(event, fail) }
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) check(event)
  }
  ctx.on('session/created', (session) => {
    for (const event of session.events) check(event)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    check(event)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the memory-event invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
