// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import { fileSource } from '../src/client/file-source.ts'

const session = { sessionId: 'session-test' as never }

function filesApi(entries: unknown[] = [], ok = true): IApiClient {
  const list = vi.fn(() => Promise.resolve({
    rpcId: 'files' as never,
    result: ok ? { ok: true as const, value: { path: '', entries, truncated: false } } : {
      ok: false as const,
      error: { code: 'file-unreadable' as const, message: 'nope', details: {} },
    },
  }))
  return { files: { list } } as never
}

describe('fileSource', () => {
  it('lists workspace-root files for an empty query and filters by prefix', async () => {
    const api = filesApi([
      { name: 'README.md', type: 'file', size: 12 },
      { name: 'src', type: 'directory' },
      { name: 'main.ts', type: 'file', size: 300 },
    ])
    const source = fileSource(api)
    const root = await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(root.map(candidate => candidate.name)).toEqual(['README.md', 'main.ts'])
    expect(root[0]?.description).toBe('12 B')
    const filtered = await source.candidates(session, { query: 'ma', position: 'leading', signal: new AbortController().signal })
    expect(filtered.map(candidate => candidate.name)).toEqual(['main.ts'])
  })

  it('browses a directory through a query path and joins the relative name', async () => {
    const api = filesApi([
      { name: 'foo.ts', type: 'file' },
      { name: 'bar.ts', type: 'file' },
    ])
    const source = fileSource(api)
    const entries = await source.candidates(session, { query: 'src/', position: 'leading', signal: new AbortController().signal })
    expect(entries.map(candidate => candidate.name)).toEqual(['src/foo.ts', 'src/bar.ts'])
  })

  it('returns no candidates when the listing fails', async () => {
    const source = fileSource(filesApi([], false))
    const entries = await source.candidates(session, { query: '', position: 'leading', signal: new AbortController().signal })
    expect(entries).toEqual([])
  })

  it('picks insert the workspace-relative path with a trailing space', () => {
    const source = fileSource(filesApi())
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
