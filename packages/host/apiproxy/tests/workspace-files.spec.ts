/**
 * The files domain and workspace download surface over a real filesystem:
 * listing/read/write/upload semantics, the workspace containment boundary
 * (schema-relative paths that escape through symlinks fail
 * `file-outside-workspace`), the sandboxed backend fence agreement, the
 * read/write/transfer bounds, and the download response statuses. The host
 * composition mirrors the web profile: SessionStore + sandboxed fs + policy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { InProcessApiClient, toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { workspaceRootOf } from '../src/workspace-files.ts'

let base: string
let workspace: string
let api: ApiProxy
let session: Session
const fibers: Promise<unknown>[] = []

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`files-${String(nextRpc++)}`), payload }
}

/** Boot one isolated harness (a second createApiProxy on one ctx would re-register the questions provider). */
async function harness(files?: {
  filesMaxTextBytes?: number
  filesMaxTransferBytes?: number
  filesMaxListingEntries?: number
}): Promise<{ api: ApiProxy; session: Session; workspace: string; dispose: () => Promise<void> }> {
  // Base under HOME, NOT tmpdir: the sandbox fence grants /tmp and
  // os.tmpdir() under workspace-write, so an outside dir under HOME is a real
  // denial (same rationale as the fs-sandbox spec).
  const ctx = new Context()
  const owned = [
    await ctx.plugin(SessionStore),
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace }),
    await ctx.plugin(SandboxedFileSystem, { cwd: workspace }),
    await ctx.plugin(UserQuestionService),
  ]
  const session = ctx.sessions.create(undefined, { meta: { cwd: workspace } })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: workspace,
    ...files,
  })
  return {
    api,
    session,
    workspace,
    dispose: async () => {
      for (const fiber of owned) await fiber.dispose()
    },
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(homedir(), '.dsh-files-'))
  workspace = join(base, 'ws')
  await mkdir(workspace)
  const booted = await harness()
  api = booted.api
  session = booted.session
})

afterEach(async () => {
  for (const fiber of fibers) await fiber.dispose()
  await rm(base, { recursive: true, force: true })
})

describe('files.list', () => {
  it('lists the workspace root with name-ordered entries and metadata', async () => {
    await mkdir(join(workspace, 'src'))
    await writeFile(join(workspace, 'README.md'), 'hello')
    await writeFile(join(workspace, '.gitignore'), 'node_modules')
    const response = await api.files.list(request({ sessionId: session.id }), new AbortController().signal)
    expect(response.result).toEqual({
      ok: true,
      value: {
        path: '',
        truncated: false,
        entries: [
          { name: '.gitignore', type: 'file', size: 12 },
          { name: 'README.md', type: 'file', size: 5 },
          { name: 'src', type: 'directory' },
        ],
      },
    })
  })

  it('lists a workspace-relative subdirectory', async () => {
    await mkdir(join(workspace, 'src'))
    await writeFile(join(workspace, 'src', 'main.ts'), 'export {}')
    const response = await api.files.list(request({ sessionId: session.id, path: 'src' }), new AbortController().signal)
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value).toEqual({
      path: 'src',
      truncated: false,
      entries: [{ name: 'main.ts', type: 'file', size: 9 }],
    })
  })

  it('rejects an unknown session', async () => {
    const response = await api.files.list(request({ sessionId: 'session-nope' as never }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-not-found' } })
  })

  it('fails a missing directory with file-not-found', async () => {
    const response = await api.files.list(request({ sessionId: session.id, path: 'absent' }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-not-found', details: { path: 'absent' } } })
  })

  it('fails a file target with file-not-directory', async () => {
    await writeFile(join(workspace, 'a.txt'), 'x')
    const response = await api.files.list(request({ sessionId: session.id, path: 'a.txt' }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-not-directory', details: { path: 'a.txt' } } })
  })

  it('marks a listing over the entry bound truncated and drops the tail', async () => {
    for (let i = 0; i < 3; i++) await writeFile(join(workspace, `f${String(i)}.txt`), 'x')
    const small = await harness({ filesMaxListingEntries: 2 })
    const response = await small.api.files.list(request({ sessionId: small.session.id }), new AbortController().signal)
    expect(response.result).toEqual({
      ok: true,
      value: {
        path: '',
        truncated: true,
        entries: [{ name: 'f0.txt', type: 'file', size: 1 }, { name: 'f1.txt', type: 'file', size: 1 }],
      },
    })
  })
})

describe('files.read', () => {
  it('reads a whole small text file', async () => {
    await writeFile(join(workspace, 'a.txt'), 'hello world')
    const response = await api.files.read(request({ sessionId: session.id, path: 'a.txt' }), new AbortController().signal)
    expect(response.result).toEqual({
      ok: true,
      value: { content: 'hello world', size: 11, truncated: false },
    })
  })

  it('returns the capped prefix with truncated for a file over the bound', async () => {
    const small = await harness({ filesMaxTextBytes: 5 })
    await writeFile(join(workspace, 'big.txt'), '0123456789')
    const response = await small.api.files.read(request({ sessionId: small.session.id, path: 'big.txt' }), new AbortController().signal)
    expect(response.result).toEqual({
      ok: true,
      value: { content: '01234', size: 10, truncated: true },
    })
  })

  it('fails a binary file with file-not-text', async () => {
    await writeFile(join(workspace, 'bin.dat'), Buffer.from([0, 1, 2, 255]))
    const response = await api.files.read(request({ sessionId: session.id, path: 'bin.dat' }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-not-text', details: { path: 'bin.dat' } } })
  })

  it('fails a missing file with file-not-found', async () => {
    const response = await api.files.read(request({ sessionId: session.id, path: 'absent.txt' }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-not-found' } })
  })

  it('fails a directory target with file-not-text', async () => {
    await mkdir(join(workspace, 'dir'))
    const response = await api.files.read(request({ sessionId: session.id, path: 'dir' }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-not-text', details: { path: 'dir' } } })
  })

  it('fails a permission-denied read with file-unreadable', async () => {
    await writeFile(join(workspace, 'locked.txt'), 'secret')
    await (await import('node:fs/promises')).chmod(join(workspace, 'locked.txt'), 0o000)
    const response = await api.files.read(request({ sessionId: session.id, path: 'locked.txt' }), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-unreadable', details: { path: 'locked.txt' } } })
    await (await import('node:fs/promises')).chmod(join(workspace, 'locked.txt'), 0o600)
  })
})

describe('files.write', () => {
  it('creates a new file atomically', async () => {
    const response = await api.files.write(request({ sessionId: session.id, path: 'new.txt', content: 'fresh' }))
    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value.operation).toBe('create')
    expect(await readFile(join(workspace, 'new.txt'), 'utf8')).toBe('fresh')
  })

  it('overwrites an existing file', async () => {
    await writeFile(join(workspace, 'a.txt'), 'old')
    const response = await api.files.write(request({ sessionId: session.id, path: 'a.txt', content: 'new' }))
    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value.operation).toBe('update')
    expect(await readFile(join(workspace, 'a.txt'), 'utf8')).toBe('new')
  })

  it('fails content over the write bound with file-too-large before any I/O', async () => {
    const small = await harness({ filesMaxTextBytes: 4 })
    const response = await small.api.files.write(request({ sessionId: small.session.id, path: 'a.txt', content: '12345' }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-too-large', details: { path: 'a.txt' } } })
  })

  it('rejects a symlink escape with file-outside-workspace and writes nothing', async () => {
    const outside = join(base, 'out')
    await mkdir(outside)
    await symlink(outside, join(workspace, 'link'))
    const response = await api.files.write(request({ sessionId: session.id, path: 'link/escaped.txt', content: 'x' }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-outside-workspace', details: { path: 'link/escaped.txt' } } })
    await expect(readFile(join(outside, 'escaped.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails a write onto a directory with file-write-failed', async () => {
    await mkdir(join(workspace, 'dir'))
    const response = await api.files.write(request({ sessionId: session.id, path: 'dir', content: 'x' }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-write-failed', details: { path: 'dir' } } })
  })
})

describe('files.upload', () => {
  it('writes the decoded bytes', async () => {
    const response = await api.files.upload(request({ sessionId: session.id, path: 'blob.bin', data: Buffer.from([0, 1, 255]).toString('base64') }))
    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value.bytes).toBe(3)
    expect(Buffer.from(await readFile(join(workspace, 'blob.bin')))).toEqual(Buffer.from([0, 1, 255]))
  })

  it('fails data over the transfer bound with file-too-large', async () => {
    const small = await harness({ filesMaxTransferBytes: 3 })
    const response = await small.api.files.upload(request({ sessionId: small.session.id, path: 'b.bin', data: Buffer.from([1, 2, 3, 4]).toString('base64') }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-too-large', details: { path: 'b.bin' } } })
  })

  it('fails an upload onto a directory with file-write-failed', async () => {
    await mkdir(join(workspace, 'dir'))
    const response = await api.files.upload(request({ sessionId: session.id, path: 'dir', data: Buffer.from([1]).toString('base64') }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'file-write-failed', details: { path: 'dir' } } })
  })
})

describe('downloads.workspaceFile', () => {
  it('serves the file bytes as an attachment', async () => {
    await writeFile(join(workspace, 'a.txt'), 'hello')
    const response = await api.downloads.workspaceFile(
      { sessionId: session.id, path: 'a.txt' },
      new AbortController().signal,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="a.txt"')
    expect(await response.text()).toBe('hello')
  })

  it('answers 404 for a missing file', async () => {
    const response = await api.downloads.workspaceFile(
      { sessionId: session.id, path: 'absent.txt' },
      new AbortController().signal,
    )
    expect(response.status).toBe(404)
  })

  it('answers 403 for a symlink escape', async () => {
    const outside = join(base, 'out')
    await mkdir(outside)
    await symlink(outside, join(workspace, 'link'))
    const response = await api.downloads.workspaceFile(
      { sessionId: session.id, path: 'link/f.txt' },
      new AbortController().signal,
    )
    expect(response.status).toBe(403)
  })

  it('answers 404 for a directory target', async () => {
    await mkdir(join(workspace, 'dir'))
    const response = await api.downloads.workspaceFile(
      { sessionId: session.id, path: 'dir' },
      new AbortController().signal,
    )
    expect(response.status).toBe(404)
  })

  it('answers 500 when the file read fails', async () => {
    await writeFile(join(workspace, 'locked.bin'), 'secret')
    await (await import('node:fs/promises')).chmod(join(workspace, 'locked.bin'), 0o000)
    const response = await api.downloads.workspaceFile(
      { sessionId: session.id, path: 'locked.bin' },
      new AbortController().signal,
    )
    expect(response.status).toBe(500)
    await (await import('node:fs/promises')).chmod(join(workspace, 'locked.bin'), 0o600)
  })

  it('answers 413 for a file over the transfer bound', async () => {
    const small = await harness({ filesMaxTransferBytes: 3 })
    await writeFile(join(workspace, 'big.bin'), Buffer.from([1, 2, 3, 4]))
    const response = await small.api.downloads.workspaceFile(
      { sessionId: small.session.id, path: 'big.bin' },
      new AbortController().signal,
    )
    expect(response.status).toBe(413)
  })
})

describe('workspaceRootOf defensive arms', () => {
  it('fails with file-unreadable when the filesystem service is not mounted', async () => {
    const bare = new Context()
    await expect(workspaceRootOf(bare, session.id)).rejects.toMatchObject({
      code: 'file-unreadable',
    })
  })

  it('fails with file-unreadable when the session has no project cwd', async () => {
    const ctx = new Context()
    const owned = [
      await ctx.plugin(SessionStore),
      await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace }),
      await ctx.plugin(SandboxedFileSystem, { cwd: workspace }),
    ]
    try {
      const cwdless = ctx.sessions.create()
      await expect(workspaceRootOf(ctx, cwdless.id)).rejects.toMatchObject({
        code: 'file-unreadable',
      })
    } finally {
      for (const fiber of owned) await fiber.dispose()
    }
  })
})

describe('the wire schema rejects escapes and malformed payloads (400)', () => {
  async function client(): Promise<InProcessApiClient> {
    const booted = await harness()
    return new InProcessApiClient(toFetchHandler(booted.api))
  }

  it('rejects an absolute path in files.list', async () => {
    const c = await client()
    const response = await c.files.list({ sessionId: session.id, path: '/etc/passwd' })
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('bad-request')
  })

  it('rejects a `..` traversal in files.write', async () => {
    const c = await client()
    const response = await c.files.write({ sessionId: session.id, path: '../escape.txt', content: 'x' })
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('bad-request')
  })

  it('rejects malformed base64 in files.upload', async () => {
    const c = await client()
    const response = await c.files.upload({ sessionId: session.id, path: 'a.bin', data: 'not base64!!!' })
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('bad-request')
  })

  it('rejects an absolute path in the download query', async () => {
    const booted = await harness()
    const handler = toFetchHandler(booted.api)
    const response = await handler.fetch(new Request(
      'http://dsh.internal/api/files.download?sessionId=' + encodeURIComponent(String(booted.session.id)) + '&path=' + encodeURIComponent('/etc/passwd'),
    ))
    expect(response.status).toBe(400)
  })
})

describe('the sandbox fence agreement', () => {
  it('a workspace write lands under the session root (explicit policy)', async () => {
    const response = await api.files.write(request({ sessionId: session.id, path: 'ok.txt', content: 'inside' }))
    expect(response.result.ok).toBe(true)
    expect(await readFile(join(workspace, 'ok.txt'), 'utf8')).toBe('inside')
  })
})
