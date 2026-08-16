/**
 * The workspace `@` trigger source: workspace file references through the
 * session-scoped files domain. The query doubles as a directory path — `@`
 * scans the workspace root, `@src/` scans `src/`, `@src/ma` filters the
 * leaves — and the scan descends subdirectories within the configured budget,
 * skipping well-known build/dependency output. A pick inserts the
 * workspace-relative path as plain text, which the model resolves with its
 * own workspace file tools. Workspace-scoped like the panel: the host rejects
 * any path escaping the session's canonical cwd.
 */

import type { IApiClient, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** The mention scan's budget: how deep and how many files it may collect. */
export interface MentionScanBudget {
  /** Maximum files one scan returns before the tail is dropped. */
  readonly maxFiles: number
  /** Maximum directory depth one scan descends from the query directory. */
  readonly maxDepth: number
  /** Directory names the scan skips (build/dependency output). */
  readonly ignoreDirs: ReadonlySet<string>
  /** Milliseconds one scanned directory tree stays cached for `@` filtering. */
  readonly cacheTtlMs: number
}

/** One collected file: its workspace-relative path and optional byte size. */
export interface MentionFile {
  readonly name: string
  readonly size?: number
}

/** Split a trigger query into the directory being scanned and the name prefix. */
function splitQuery(query: string): { dir: string; prefix: string } {
  const slash = query.lastIndexOf('/')
  if (slash === -1) return { dir: '', prefix: query }
  return { dir: query.slice(0, slash), prefix: query.slice(slash + 1) }
}

/** One directory listing, or undefined when the request was aborted or failed. */
async function listDirectory(
  api: IApiClient,
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<IApiClient['files']['list']>> | undefined> {
  try {
    return await api.files.list({ sessionId, path }, signal)
  } catch {
    return undefined
  }
}

/**
 * Recursively collect workspace files under one directory, bounded by the
 * scan budget. The walk is depth-first and sequential — each listing is a
 * fast local read, and the per-keystroke signal supersedes stale scans.
 * @param api - the session-scoped files client.
 * @param sessionId - the owning session.
 * @param dir - the workspace-relative directory to scan (`''` = the root).
 * @param budget - the scan's file/depth caps and skipped directory names.
 * @param signal - cancellation; aborted scans stop early.
 * @returns the collected files and whether the budget cut the scan short.
 */
export async function collectFiles(
  api: IApiClient,
  sessionId: SessionId,
  dir: string,
  budget: MentionScanBudget,
  signal: AbortSignal,
): Promise<{ files: MentionFile[]; truncated: boolean }> {
  const files: MentionFile[] = []
  let truncated = false
  async function walk(path: string, depth: number): Promise<void> {
    if (signal.aborted || files.length >= budget.maxFiles || depth > budget.maxDepth) {
      if (files.length >= budget.maxFiles || depth > budget.maxDepth) truncated = true
      return
    }
    // An aborted or failed listing ends that subtree's scan; the per-keystroke
    // signal supersedes stale scans, and a broken directory should not fail
    // the whole mention.
    const listing = await listDirectory(api, sessionId, path, signal)
    if (listing === undefined) {
      return
    }
    if (!listing.result.ok) {
      return
    }
    if (listing.result.value.truncated) truncated = true
    for (const entry of listing.result.value.entries) {
      if (files.length >= budget.maxFiles) {
        truncated = true
        return
      }
      const rel = path === '' ? entry.name : `${path}/${entry.name}`
      if (entry.type === 'directory') {
        if (budget.ignoreDirs.has(entry.name)) continue
        await walk(rel, depth + 1)
      } else {
        files.push({
          name: rel,
          ...(entry.size === undefined ? {} : { size: entry.size }),
        })
      }
    }
  }
  await walk(dir, 0)
  return { files, truncated }
}

/**
 * Build the file source over one session-scoped files client.
 * @param api - the wire client the Files panel shares (session-scoped files domain).
 * @param budget - the mention scan's file/depth caps and skipped directory names.
 * @param truncatedHint - candidate hint rendered when the scan budget cut the listing short.
 * @returns the trigger source for the `@` trigger.
 */
export function fileSource(
  api: IApiClient,
  budget: MentionScanBudget,
  truncatedHint: string,
): InputTriggerSource {
  // The per-keystroke pipeline supersedes stale candidates; without a cache
  // every keystroke would re-walk the whole tree and abort the previous walk
  // mid-flight (an aborted-fetch storm in the console). Each scanned
  // directory tree is cached for the budget's TTL. The scan that populates
  // the cache runs detached and single-flight: a keystroke aborting the
  // previous candidates must not kill the one walk the cache needs — the
  // walk is bounded by the budget (file/depth caps), and later queries
  // filter the completed tree instead of restarting it.
  const treeCache = new Map<string, { files: MentionFile[]; truncated: boolean; expires: number }>()
  const inflight = new Map<string, Promise<{ files: MentionFile[]; truncated: boolean }>>()
  const scanTree = async (sessionId: string, dir: string): Promise<{ files: MentionFile[]; truncated: boolean }> => {
    const key = `${sessionId}\u0000${dir}`
    const cached = treeCache.get(key)
    if (cached !== undefined && cached.expires >= Date.now()) return cached
    let pending = inflight.get(key)
    if (pending === undefined) {
      pending = (async () => {
        const collected = await collectFiles(api, sessionId as never, dir, budget, new AbortController().signal)
        treeCache.set(key, { ...collected, expires: Date.now() + budget.cacheTtlMs })
        return collected
      })()
      inflight.set(key, pending)
      void pending.finally(() => { inflight.delete(key) })
    }
    return pending
  }
  return {
    trigger: '@',
    name: 'files',
    async candidates(session, { query }) {
      const { dir, prefix } = splitQuery(query)
      const { files, truncated } = await scanTree(session.sessionId, dir)
      return files
        .filter(file => file.name.split('/').pop()?.includes(prefix) === true)
        .map(file => ({
          name: file.name,
          ...(file.size === undefined ? {} : { description: `${file.size} B` }),
          ...(truncated ? { hint: truncatedHint } : {}),
        }))
    },
    onPick({ candidate }) {
      // Plain-text workspace-relative path; the model reads it with its tools.
      return { text: `${candidate.name} ` }
    },
  }
}
