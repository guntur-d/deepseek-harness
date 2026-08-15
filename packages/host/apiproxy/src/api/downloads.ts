/**
 * downloads domain contract: host-only download surfaces — the GET-download
 * channel family, the mirror of the SSE-stream `events` domain. No wire
 * envelope: the carrier's GET routes answer these directly, and the browser
 * `IApiClient` never exposes them.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
export interface DownloadsApi {
  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>

  /**
   * Stream one workspace file as an attachment response, bounded by the
   * deployment's transfer limit. Same session-scoped containment as the
   * `files` RPC domain: the path is workspace-relative and must resolve under
   * the session's canonical cwd. The carrier's GET route answers this
   * directly; the browser never calls it.
   * @param request - the owning session and the workspace-relative file path.
   * @param signal - cancellation for the underlying read.
   * @returns the file attachment; a missing target answers 404, a path that
   * escapes the workspace 403, and a file over the transfer bound 413.
   */
  workspaceFile(
    request: { sessionId: SessionId; path: string },
    signal: AbortSignal,
  ): Promise<Response>
}
