/**
 * Workspace Files panel plugin, browser half: registers the `files` tab in
 * the conversation view ring. Every injected operation binds the owning
 * session through the connection's api client (files.list/read/write/upload
 * plus the workspace download surface), so components never see a session
 * id or the connection handle. The panel is deliberately workspace-scoped:
 * the host resolves the session's canonical cwd and rejects any path that
 * escapes it — this surface is not privileged.
 */

import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FilesView } from './FilesView.tsx'
import { fileSource } from './file-source.ts'
import type { FilesViewInjected } from './contract.ts'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { en, NS, zh } from './locales.ts'

export type { FilesViewInjected } from './contract.ts'

/** Required services: the view slot, the wire client, and the locale service. */
export const inject = ['slots', 'connection', 'locale', 'inputTriggers']

/**
 * Client plugin body: register the Files view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-files: dictionaries')
  const t = ctx.locale.bind(NS)
  const api = (ctx.get('connection') as ConnectionHandle).api
  // The '@' trigger source: workspace file references in the composer. It
  // rides the same session-scoped files client as the panel below.
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(fileSource(api)), 'ui-files: @ file source')

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'files',
    order: 20,
    locale: NS,
    label: () => t('view.files'),
    inject: (sessionId: SessionId): FilesViewInjected => {
      // All paths are workspace-relative; the host contains them under the
      // session's canonical cwd.
      const resolve = (path: string): { sessionId: SessionId; path: string } => ({ sessionId, path })
      return {
        list: (path, signal) => api.files.list(resolve(path), signal).then(({ result }) => {
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }),
        read: (path, signal) => api.files.read(resolve(path), signal).then(({ result }) => {
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }),
        write: (path, content) => api.files.write({ sessionId, path, content }).then(({ result }) => {
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }),
        upload: (path, data) => api.files.upload({ sessionId, path, data }).then(({ result }) => {
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }),
        download: (path) => {
          // Same-origin Host download URL, with the connection carrier's
          // null-origin fallback (fixture mode serves 404 from the surface).
          // The facet cast keeps the runtime guard for location-less contexts
          // (jsdom fixture pages) while satisfying the typed-DOM linter.
          const locationFacet = globalThis as { location?: { origin?: string } }
          const origin = locationFacet.location?.origin
          const base = origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
          const url = new URL('/api/files.download', base)
          url.searchParams.set('sessionId', String(sessionId))
          url.searchParams.set('path', path)
          const anchor = document.createElement('a')
          anchor.href = url.toString()
          /* v8 ignore next -- split('/').pop() is never null for a schema-valid non-empty path; the arm guards a future caller. */
          anchor.download = path.split('/').pop() ?? 'file'
          anchor.click()
        },
      }
    },
  }, FilesView))
}
