/**
 * files domain contract: workspace-scoped file browsing, editing, and upload,
 * addressed by session. The session's header cwd resolves to the canonical
 * workspace root host-side — the client never submits an absolute path, only
 * workspace-relative paths (schema-rejected as absolute, then containment-checked
 * against the canonical root by the implementation). Reads and writes reuse the
 * `ctx.fs` seam (the filesystem Service Definition), so the same backend,
 * atomicity, and policy fence apply as to the model-facing tools; this domain
 * adds the workspace boundary the panel promises: every path must stay under
 * the session's own cwd. Downloads are a separate host-only GET surface
 * (`downloads.workspaceFile`), the mirror of `session.export`.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One row of a workspace directory listing. */
export interface FilesEntry {
  /** Basename inside the listed directory. */
  readonly name: string
  /** Whether the child is a regular file, a directory, or something else. */
  readonly type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend can report it. */
  readonly size?: number
}

/** One directory level of a workspace listing. */
export interface FilesListing {
  /** Workspace-relative path of the listed directory (`''` = the workspace root). */
  readonly path: string
  /** Direct children, name-sorted; entries carry metadata only, never content. */
  readonly entries: readonly FilesEntry[]
  /** True when the backend cut the listing at its complete-result bound (the name-sorted tail is absent). */
  readonly truncated: boolean
}

/** A bounded text read of one workspace file. */
export interface FileContent {
  /** The decoded UTF-8 content, at most the configured read bound. */
  readonly content: string
  /** Full byte size of the file on disk (the viewer shows when the read was capped). */
  readonly size: number
  /** True when the file exceeds the read bound and `content` is only its capped prefix. */
  readonly truncated: boolean
}

/** Receipt of a workspace text write or byte upload. */
export interface FileWriteReceipt {
  /** Whether the write created a new file or replaced an existing one. */
  readonly operation: 'create' | 'update'
  /** Opaque post-write version of the file. */
  readonly version: string
  /** Bytes written (decoded for uploads; UTF-8 length for text writes). */
  readonly bytes: number
}

/**
 * Files-domain unary methods (map keys `files.*` of RpcMethodMap). Every
 * method carries `sessionId` in the payload; the host resolves the session's
 * canonical cwd and rejects any path that escapes it (`file-outside-workspace`).
 */
export interface FilesApi {
  /**
   * List one workspace-relative directory level. An absent path lists the
   * workspace root; a missing target fails `file-not-found`, a file target
   * `file-not-directory`, and a permission failure `file-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   * @param request - the owning session and the workspace-relative directory to list.
   * @param signal - cancellation for the underlying listing.
   * @returns the directory level plus its truncation flag.
   */
  list(
    request: RpcRequest<{ sessionId: SessionId; path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<FilesListing>>

  /**
   * Read one workspace file as bounded UTF-8 text. Binary or invalid-UTF-8
   * content fails `file-not-text`; a file beyond the read bound returns its
   * capped prefix with `truncated: true` (the panel refuses to edit a
   * truncated view — overwriting it would destroy the tail).
   * @param request - the owning session and the workspace-relative file path.
   * @param signal - cancellation for the underlying read.
   * @returns the decoded content, its full size, and the truncation flag.
   */
  read(
    request: RpcRequest<{ sessionId: SessionId; path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<FileContent>>

  /**
   * Atomically create or replace one workspace file's UTF-8 text. Content
   * beyond the configured write bound fails `file-too-large` before any I/O;
   * mutation failures (stale guard, non-regular target, IO) map to
   * `file-write-failed`. The write runs under the same sandbox policy fence as
   * the model-facing tools, with the session's workspace root as the boundary.
   * @param request - the owning session, the workspace-relative file path, and the full new content.
   * @returns the write receipt.
   */
  write(
    request: RpcRequest<{ sessionId: SessionId; path: string; content: string }>,
  ): Promise<RpcResponse<FileWriteReceipt>>

  /**
   * Upload one workspace file as base64-encoded bytes (the JSON envelope keeps
   * the cross-site write fence: no raw-body route bypasses the content-type
   * gate). The decoded size beyond the configured upload bound fails
   * `file-too-large`; malformed base64 fails `bad-request`. The write runs
   * under the same sandbox policy fence as the model-facing tools.
   * @param request - the owning session, the workspace-relative file path, and the base64 data.
   * @returns the upload receipt.
   */
  upload(
    request: RpcRequest<{ sessionId: SessionId; path: string; data: string }>,
  ): Promise<RpcResponse<FileWriteReceipt>>
}
