// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import { collectFiles, fileSource, type MentionScanBudget } from '../src/client/file-source.ts'

const session = { sessionId: 'session-test' as never }

/** A stub files client backed by a flat name → entry map (paths are keys). */
function filesApi(
  tree: Record<string, Array<{ name: string; type: 'file' | 'directory'; size?: number }>>,
  ok = true,
  truncated = false,
): IApiClient {
  const list = vi.fn(({ path }: { path: string }) => Promise.resolve({
    rpcId: 'files' as never,
    result: ok ? { ok: true as const, value: { path, entries: tree[path] ?? [], truncated } } : {
      ok: false as const,
      error: { code: 'file-unreadable' as const, message: 'nope', details: {} },
    },
  }))
  return { files: { list } } as never
}

/** The list spy behind a {@link filesApi} client, for call-count assertions. */
function listSpy(api: IApiClient): ReturnType<typeof vi.fn> {
  return (api.files as unknown as { list: ReturnType<typeof vi.fn> }).list
}

const budget: MentionScanBudget = {
  maxFiles: 10,
  maxDepth: 8,
  ignoreDirs: new Set(['node_modules', '.git', 'dist']),
  cacheTtlMs: 60_000,
}

describe('collectFiles', () => {
  it('scans the root and descends subdirectories with joined relative paths', async () => {
    const api = filesApi({
      '': [{ name: 'README.md', type: 'file', size: 12 }, { name: 'src', type: 'directory' }],
      'src': [{ name: 'index.ts', type: 'file', size: 300 }, { name: 'components', type: 'directory' }],
      'src/components': [{ name: 'App.tsx', type: 'file' }],
    })
    const { files } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files.map(file => file.name)).toEqual(['README.md', 'src/index.ts', 'src/components/App.tsx'])
  })

  it('skips ignored directories', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }, { name: 'node_modules', type: 'directory' }],
      'node_modules': [{ name: 'lodash', type: 'directory' }],
      'node_modules/lodash': [{ name: 'index.js', type: 'file' }],
    })
    const { files } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files.map(file => file.name)).toEqual(['a.txt'])
  })

  it('stops at the file cap and reports truncation', async () => {
    const api = filesApi({
      '': [
        { name: 'a.txt', type: 'file' }, { name: 'b.txt', type: 'file' },
        { name: 'c.txt', type: 'file' }, { name: 'd.txt', type: 'file' },
        { name: 'e.txt', type: 'file' }, { name: 'f.txt', type: 'file' },
        { name: 'g.txt', type: 'file' }, { name: 'h.txt', type: 'file' },
        { name: 'i.txt', type: 'file' }, { name: 'j.txt', type: 'file' },
        { name: 'k.txt', type: 'file' },
      ],
    })
    const { files, truncated } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files).toHaveLength(10)
    expect(truncated).toBe(true)
  })

  it('stops at the depth cap and reports truncation', async () => {
    const api = filesApi({
      '': [{ name: 'd1', type: 'directory' }],
      'd1': [{ name: 'd2', type: 'directory' }],
      'd1/d2': [{ name: 'd3', type: 'directory' }],
      'd1/d2/d3': [{ name: 'd4', type: 'directory' }],
      'd1/d2/d3/d4': [{ name: 'd5', type: 'directory' }],
      'd1/d2/d3/d4/d5': [{ name: 'deep.txt', type: 'file' }],
    })
    const { files, truncated } = await collectFiles(
      api, session.sessionId, '', { ...budget, maxDepth: 3 }, new AbortController().signal,
    )
    expect(files).toEqual([])
    expect(truncated).toBe(true)
  })

  it('returns nothing when the listing fails', async () => {
    const api = filesApi({}, false)
    const { files, truncated } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files).toEqual([])
    expect(truncated).toBe(false)
  })

  it('stops descending after the cap and reports truncation at the top of a subtree walk', async () => {
    const api = filesApi({
      '': [
        { name: 'a.txt', type: 'file' }, { name: 'b.txt', type: 'file' },
        { name: 'c.txt', type: 'file' }, { name: 'd.txt', type: 'file' },
        { name: 'e.txt', type: 'file' }, { name: 'f.txt', type: 'file' },
        { name: 'g.txt', type: 'file' }, { name: 'h.txt', type: 'file' },
        { name: 'i.txt', type: 'file' }, { name: 'j.txt', type: 'file' },
        { name: 'more', type: 'directory' },
      ],
      'more': [{ name: 'k.txt', type: 'file' }],
    })
    const { files, truncated } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files).toHaveLength(10)
    expect(truncated).toBe(true)
  })

  it('ends the scan when a subtree listing rejects', async () => {
    const tree: Record<string, Array<{ name: string; type: 'file' | 'directory' }>> = {
      '': [{ name: 'broken', type: 'directory' }],
    }
    const api = filesApi(tree)
    ;(api.files.list as unknown as { mockImplementation: (fn: (request: { path: string }) => Promise<unknown>) => void })
      .mockImplementation(({ path }) => path === 'broken'
        ? Promise.reject(new Error('aborted'))
        : Promise.resolve({
          rpcId: 'files' as never,
          result: { ok: true as const, value: { path, entries: tree[path] ?? [], truncated: false } },
        }))
    const { files, truncated } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files).toEqual([])
    expect(truncated).toBe(false)
  })

  it('marks the scan truncated when a listing reports truncation', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }],
    }, true, true)
    const { files, truncated } = await collectFiles(api, session.sessionId, '', budget, new AbortController().signal)
    expect(files).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('returns immediately when the signal already aborted', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }],
    })
    const controller = new AbortController()
    controller.abort()
    const { files, truncated } = await collectFiles(api, session.sessionId, '', budget, controller.signal)
    expect(files).toEqual([])
    expect(truncated).toBe(false)
    expect(listSpy(api)).not.toHaveBeenCalled()
  })
})

describe('fileSource', () => {
  it('lists scanned files for an empty query and filters leaves by prefix', async () => {
    const api = filesApi({
      '': [{ name: 'README.md', type: 'file', size: 12 }, { name: 'src', type: 'directory' }],
      'src': [{ name: 'main.ts', type: 'file', size: 300 }, { name: 'util.ts', type: 'file' }],
    })
    const source = fileSource(api, budget, 'truncated')
    const root = await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(root.map(candidate => candidate.name)).toEqual(['README.md', 'src/main.ts', 'src/util.ts'])
    expect(root[0]?.description).toBe('12 B')
    const filtered = await source.candidates(session, { query: 'ma', position: 'leading', signal: new AbortController().signal })
    expect(filtered.map(candidate => candidate.name)).toEqual(['src/main.ts'])
    const subdir = await source.candidates(session, { query: 'src/', position: 'leading', signal: new AbortController().signal })
    expect(subdir.map(candidate => candidate.name)).toEqual(['src/main.ts', 'src/util.ts'])
  })

  it('attaches the truncated hint to every candidate when the budget cut the scan', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }, { name: 'b.txt', type: 'file' }],
    })
    const source = fileSource(api, { ...budget, maxFiles: 1 }, 'truncated-hint')
    const entries = await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(entries.every(candidate => candidate.hint === 'truncated-hint')).toBe(true)
  })

  it('returns no candidates when the listing fails', async () => {
    const source = fileSource(filesApi({}, false), budget, 'truncated')
    const entries = await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(entries).toEqual([])
  })

  it('filters the cached tree on subsequent queries instead of re-walking', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }, { name: 'b.txt', type: 'file' }],
    })
    const source = fileSource(api, budget, 'truncated')
    await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    await source.candidates(session, { query: 'a', position: 'leading', signal: new AbortController().signal })
    expect(listSpy(api)).toHaveBeenCalledTimes(1)
  })

  it('builds the cache even when the pipeline signal already aborted', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }, { name: 'b.txt', type: 'file' }],
    })
    const source = fileSource(api, budget, 'truncated')
    const controller = new AbortController()
    controller.abort()
    // The source's detached scan ignores the pipeline abort (the controller
    // drops the stale settle); the cache gets populated either way.
    const stale = await source.candidates(session, { query: '', position: 'leading', signal: controller.signal })
    expect(stale.map(candidate => candidate.name)).toEqual(['a.txt', 'b.txt'])
    // The next live query filters the cached tree without re-walking.
    const fresh = await source.candidates(session, { query: 'b', position: 'leading', signal: new AbortController().signal })
    expect(fresh.map(candidate => candidate.name)).toEqual(['b.txt'])
    expect(listSpy(api)).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight scan between concurrent queries', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }],
    })
    const source = fileSource(api, budget, 'truncated')
    await Promise.all([
      source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal }),
      source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal }),
    ])
    expect(listSpy(api)).toHaveBeenCalledTimes(1)
  })

  it('re-walks the tree after the cache TTL expires', async () => {
    const api = filesApi({
      '': [{ name: 'a.txt', type: 'file' }],
    })
    const source = fileSource(api, { ...budget, cacheTtlMs: -1 }, 'truncated')
    await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(listSpy(api)).toHaveBeenCalledTimes(2)
  })

  it('picks insert the workspace-relative path with a trailing space', () => {
    const source = fileSource(filesApi({}), budget, 'truncated')
    const outcome = source.onPick({
      candidate: { name: 'src/main.ts' },
      session,
      position: 'leading',
      via: 'enter',
      span: { start: 0, end: 3, draftRev: 0 },
    })
    expect(outcome).toEqual({ text: 'src/main.ts ' })
  })
})
