/**
 * The workspace `@` trigger source: workspace file references through the
 * session-scoped files domain. The query doubles as a directory path — `@`
 * lists the workspace root, `@src/` lists `src/`, `@src/ma` filters it — and
 * a pick inserts the workspace-relative path as plain text, which the model
 * resolves with its own workspace file tools. Workspace-scoped like the
 * panel: the host rejects any path escaping the session's canonical cwd.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** Split a trigger query into the directory being browsed and the name prefix. */
function splitQuery(query: string): { dir: string; prefix: string } {
  const slash = query.lastIndexOf('/')
  if (slash === -1) return { dir: '', prefix: query }
  return { dir: query.slice(0, slash), prefix: query.slice(slash + 1) }
}

/**
 * Build the file source over one session-scoped files client.
 * @param api - the wire client the Files panel shares (session-scoped files domain).
 * @returns the trigger source for the `@` trigger.
 */
export function fileSource(api: IApiClient): InputTriggerSource {
  return {
    trigger: '@',
    name: 'files',
    async candidates(session, { query, signal }) {
      const { dir, prefix } = splitQuery(query)
      const { result } = await api.files.list({ sessionId: session.sessionId, path: dir }, signal)
      if (!result.ok) return []
      return result.value.entries
        .filter(entry => entry.type === 'file' && entry.name.includes(prefix))
        .map(entry => ({
          name: dir === '' ? entry.name : `${dir}/${entry.name}`,
          ...(entry.size === undefined ? {} : { description: `${entry.size} B` }),
        }))
    },
    onPick({ candidate }) {
      // Plain-text workspace-relative path; the model reads it with its tools.
      return { text: `${candidate.name} ` }
    },
  }
}
