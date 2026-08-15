/**
 * Workspace-scoped file operations shared by the `files` RPC domain and the
 * `downloads.workspaceFile` GET surface. One boundary rule covers every
 * operation: the session's canonical `header.cwd` is the workspace root, and
 * a client-supplied workspace-relative path must resolve (through symlinks,
 * which `fs.resolve` realpaths) to a target the root CONTAINS — anything else
 * fails `file-outside-workspace`. Reads reuse the fs seam's text/byte
 * primitives (binary rejection, atomicity, and the sandbox fence apply
 * exactly as for the model-facing tools); writes carry an explicit
 * `workspace-write` policy rooted at the canonical workspace so the sandboxed
 * backend's fence agrees with this domain's containment gate.
 * @module
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { FileContent, FilesEntry, FilesListing, FileWriteReceipt } from './api/files.ts'

/** Default bounds for the files domain (validated config overrides them). */
export const DEFAULT_FILES_MAX_TEXT_BYTES = 1024 * 1024
/** Default decoded-byte bound for uploads and the download surface. */
export const DEFAULT_FILES_MAX_TRANSFER_BYTES = 64 * 1024 * 1024
/** Default complete-result bound on one directory listing. */
export const DEFAULT_FILES_MAX_LISTING_ENTRIES = 2000

/** Structured failure for a workspace-files operation (mapped to RpcError by the domain). */
export class WorkspaceFilesError extends Error {
  /**
   * @param code - the wire code this failure maps to.
   * @param path - the workspace-relative path the operation named.
   * @param message - human-readable failure detail.
   */
  constructor(
    readonly code: 'file-outside-workspace' | 'file-not-found' | 'file-not-directory'
      | 'file-not-text' | 'file-too-large' | 'file-unreadable' | 'file-write-failed',
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceFilesError'
  }
}

/** The resolved workspace root for one session. */
export interface WorkspaceRoot {
  /** Canonical root target (realpath'd through the fs seam). */
  readonly root: FsTarget
  /** Absolute path of the root, for the sandbox policy's workspaceRoot. */
  readonly rootPath: string
}

/**
 * Resolve a live session's canonical workspace root through the fs seam.
 * @param ctx - composed host context (`ctx.get('fs')` must serve the seam).
 * @param sessionId - the owning session.
 * @returns the canonical root target and its absolute path.
 */
export async function workspaceRootOf(ctx: Context, sessionId: SessionId): Promise<WorkspaceRoot> {
  const fs = ctx.get('fs') as FileSystem | undefined
  if (fs === undefined) {
    throw new WorkspaceFilesError('file-unreadable', '', 'the filesystem service is not mounted')
  }
  const session = ctx.sessions.get(sessionId) as Session | undefined
  if (session === undefined) {
    throw new WorkspaceFilesError('file-not-found', '', `session "${sessionId}" is not attached`)
  }
  const cwd = session.header.cwd
  if (cwd === undefined) {
    throw new WorkspaceFilesError('file-unreadable', '', `session "${sessionId}" has no project cwd`)
  }
  const root = await fs.resolve(cwd)
  return { root, rootPath: fs.processPath(root) }
}

/**
 * Resolve a workspace-relative path and require it to stay under the root.
 * The schema already rejects absolute spellings and `..` segments; this is
 * the authoritative gate for what the schema cannot see (symlink escapes —
 * `fs.resolve` realpaths, so a link pointing out of the workspace fails here).
 * @param fs - the filesystem seam.
 * @param root - the canonical workspace root.
 * @param path - workspace-relative path (`''` resolves the root itself).
 * @returns the contained target.
 */
export async function resolveContained(
  fs: FileSystem,
  root: WorkspaceRoot,
  path: string,
): Promise<FsTarget> {
  const target = path === '' ? root.root : await fs.resolve(path, { cwd: root.rootPath })
  if (!fs.contains(root.root, target)) {
    throw new WorkspaceFilesError(
      'file-outside-workspace',
      path,
      `path "${path}" resolves outside the session workspace`,
    )
  }
  return target
}

/** The workspace-write policy every files-domain write carries (rooted at the workspace). */
export function workspaceWritePolicy(root: WorkspaceRoot): SandboxExecutionPolicy {
  return { mode: 'workspace-write', workspaceRoot: root.rootPath }
}

/**
 * List one workspace directory level with the listing bound applied.
 * @param fs - the filesystem seam.
 * @param root - the canonical workspace root.
 * @param path - workspace-relative directory (`''` = the root).
 * @param maxEntries - complete-result bound; past it the tail is dropped and `truncated` is set.
 * @param signal - aborts the listing.
 * @returns the directory level.
 */
export async function listWorkspaceFiles(
  fs: FileSystem,
  root: WorkspaceRoot,
  path: string,
  maxEntries: number,
  signal: AbortSignal,
): Promise<FilesListing> {
  const target = await resolveContained(fs, root, path)
  const info = await fs.stat(target, signal)
  if (info === undefined) throw new WorkspaceFilesError('file-not-found', path, `directory "${path}" does not exist`)
  if (info.type !== 'directory') throw new WorkspaceFilesError('file-not-directory', path, `"${path}" is not a directory`)
  const entries = await fs.listDir(target, signal)
  const truncated = entries.length > maxEntries
  const rows = truncated ? entries.slice(0, maxEntries) : entries
  return {
    path,
    entries: rows.map((entry): FilesEntry => ({
      name: entry.name,
      type: entry.type,
      ...entry.size === undefined ? {} : { size: entry.size },
    })),
    truncated,
  }
}

/**
 * Read one workspace file as bounded UTF-8 text. Binary content fails
 * `file-not-text`; a file beyond the bound returns its capped prefix with
 * `truncated: true` (the panel refuses to edit a truncated view).
 * @param fs - the filesystem seam.
 * @param root - the canonical workspace root.
 * @param path - workspace-relative file path.
 * @param maxBytes - the read bound on the complete result.
 * @param signal - aborts the read.
 * @returns the decoded content, its full size, and the truncation flag.
 */
export async function readWorkspaceFile(
  fs: FileSystem,
  root: WorkspaceRoot,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<FileContent> {
  const target = await resolveContained(fs, root, path)
  const info = await fs.stat(target, signal)
  if (info === undefined) throw new WorkspaceFilesError('file-not-found', path, `file "${path}" does not exist`)
  if (info.type !== 'file') throw new WorkspaceFilesError('file-not-text', path, `"${path}" is not a regular file`)
  /* v8 ignore next -- the local backend reports a byte size for every regular file; the fallback guards backends without size reporting. */
  const size = info.size ?? 0
  try {
    return await readCappedText(fs, target, path, maxBytes, size, signal)
  } catch (error: unknown) {
    throw mapSeamReadError(error, path)
  }
}

/** The bounded text read itself (the caller maps seam failures). */
async function readCappedText(
  fs: FileSystem,
  target: FsTarget,
  path: string,
  maxBytes: number,
  size: number,
  signal: AbortSignal,
): Promise<FileContent> {
  let content = ''
  let bytes = 0
  let truncated = false
  for await (const chunk of await fs.streamText(target, signal)) {
    const chunkBytes = Buffer.byteLength(chunk, 'utf8')
    if (bytes + chunkBytes > maxBytes) {
      // Keep a code-point-aligned prefix of the overshooting chunk so a small
      // bound still shows real content, then stop (the download surface serves
      // the rest). streamText chunks end at code-point boundaries, so iterating
      // the chunk's code points cannot split a multi-byte sequence.
      const remaining = maxBytes - bytes
      let taken = ''
      let takenBytes = 0
      for (const codePoint of chunk) {
        const codePointBytes = Buffer.byteLength(codePoint, 'utf8')
        if (takenBytes + codePointBytes > remaining) break
        taken += codePoint
        takenBytes += codePointBytes
      }
      content += taken
      truncated = true
      break
    }
    content += chunk
    bytes += chunkBytes
  }
  /* v8 ignore next -- stat size equals the streamed bytes for a stable file; only a
  concurrent shrink between stat and read could differ, which the flag conservatively reports. */
  if (size > bytes && !truncated) truncated = true
  return { content, size, truncated }
}

/**
 * Atomically write UTF-8 text into the workspace (bounded before any I/O).
 * @param fs - the filesystem seam.
 * @param root - the canonical workspace root.
 * @param path - workspace-relative file path.
 * @param content - the full new file content.
 * @param maxBytes - the write bound; longer content fails `file-too-large`.
 * @returns the write receipt.
 */
export async function writeWorkspaceText(
  fs: FileSystem,
  root: WorkspaceRoot,
  path: string,
  content: string,
  maxBytes: number,
): Promise<FileWriteReceipt> {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > maxBytes) {
    throw new WorkspaceFilesError('file-too-large', path, `content is ${bytes} bytes, over the ${maxBytes}-byte write bound`)
  }
  const target = await resolveContained(fs, root, path)
  try {
    const outcome = await fs.writeText(target, content, undefined, undefined, workspaceWritePolicy(root))
    return { operation: outcome.operation, version: String(outcome.version), bytes }
  } catch (error: unknown) {
    throw mapSeamWriteError(error, path)
  }
}

/**
 * Upload raw bytes into the workspace (base64 already validated by the schema;
 * the decoded bound is enforced before any I/O).
 * @param fs - the filesystem seam.
 * @param root - the canonical workspace root.
 * @param path - workspace-relative file path.
 * @param data - the decoded file bytes.
 * @param maxBytes - the decoded-byte bound; longer data fails `file-too-large`.
 * @returns the upload receipt.
 */
export async function uploadWorkspaceBytes(
  fs: FileSystem,
  root: WorkspaceRoot,
  path: string,
  data: Uint8Array,
  maxBytes: number,
): Promise<FileWriteReceipt> {
  if (data.byteLength > maxBytes) {
    throw new WorkspaceFilesError(
      'file-too-large',
      path,
      `upload is ${data.byteLength} bytes, over the ${maxBytes}-byte upload bound`,
    )
  }
  const target = await resolveContained(fs, root, path)
  try {
    const outcome = await fs.writeBytes(target, data, undefined, undefined, workspaceWritePolicy(root))
    return { operation: outcome.operation, version: String(outcome.version), bytes: data.byteLength }
  } catch (error: unknown) {
    throw mapSeamWriteError(error, path)
  }
}

/**
 * Stream one workspace file as a download response (the `downloads` surface).
 * @param fs - the filesystem seam.
 * @param root - the canonical workspace root.
 * @param path - workspace-relative file path.
 * @param maxBytes - the transfer bound; a larger file fails 413.
 * @param signal - aborts the read.
 * @returns an attachment response with the file bytes.
 */
export async function downloadWorkspaceFile(
  fs: FileSystem,
  root: WorkspaceRoot,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Response> {
  let target: FsTarget
  try {
    target = await resolveContained(fs, root, path)
  } catch (error: unknown) {
    return responseFor(error)
  }
  const info = await fs.stat(target, signal)
  if (info === undefined) {
    return new Response(`file "${path}" does not exist`, { status: 404 })
  }
  if (info.type !== 'file') {
    return new Response(`"${path}" is not a regular file`, { status: 404 })
  }
  /* v8 ignore next -- the local backend reports a byte size for every regular file; the fallback guards backends without size reporting. */
  const size = info.size ?? 0
  if (size > maxBytes) {
    return new Response(`"${path}" is ${size} bytes, over the ${maxBytes}-byte download bound`, { status: 413 })
  }
  let data: Uint8Array
  try {
    data = await fs.readBytes(target, signal, maxBytes)
  } catch (error: unknown) {
    return responseFor(error)
  }
  return new Response(Buffer.from(data), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${sanitizeFilename(basename(path))}"`,
      'content-length': String(data.byteLength),
    },
  })
}

/** Map a seam read failure (binary rejection, permission, IO) onto the files vocabulary. */
function mapSeamReadError(error: unknown, path: string): WorkspaceFilesError {
  /* v8 ignore next -- seam read failures are always Error instances; the String arm guards a non-Error throw. */
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof FsError && error.code === 'FS_NOT_TEXT') {
    return new WorkspaceFilesError('file-not-text', path, message)
  }
  return new WorkspaceFilesError('file-unreadable', path, message)
}

/** Map a seam write failure (already fenced and atomic) onto the files vocabulary. */
function mapSeamWriteError(error: unknown, path: string): WorkspaceFilesError {
  /* v8 ignore next -- seam write failures are always Error instances; the String arm guards a non-Error throw. */
  const message = error instanceof Error ? error.message : String(error)
  return new WorkspaceFilesError('file-write-failed', path, message)
}

/** A download failure as an HTTP response (never an unhandled throw). */
function responseFor(error: unknown): Response {
  /* v8 ignore next -- download failures are always Error instances; the String arm guards a non-Error throw. */
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof WorkspaceFilesError && error.code === 'file-outside-workspace') {
    return new Response(message, { status: 403 })
  }
  return new Response(message, { status: 500 })
}

/** Keep a download filename free of header-injection characters. */
function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '_')
}
