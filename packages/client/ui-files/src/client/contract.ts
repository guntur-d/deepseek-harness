/**
 * Files panel contract: the injected session-bound operations the view
 * drives and the locale seat. The register inject factory (apply closure)
 * binds the owning session into every call — components never see a
 * session id or the connection handle.
 */

import type { FileContent, FilesListing, FileWriteReceipt } from '@deepseek-ai/dsh-client-connection/client'

/**
 * Session-bound file operations plus the presentation bounds. `list`/`read`
 * take the caller's AbortSignal so a closed panel stops an in-flight scan
 * or read; `write`/`upload` are atomic host-side and need no signal.
 */
export interface FilesViewInjected {
  /** List one workspace-relative directory level (`''` = the workspace root). */
  list: (path: string, signal: AbortSignal) => Promise<FilesListing>
  /** Read one workspace file as bounded text (truncated flag when capped). */
  read: (path: string, signal: AbortSignal) => Promise<FileContent>
  /** Atomically write one workspace file's text. */
  write: (path: string, content: string) => Promise<FileWriteReceipt>
  /** Upload one workspace file from base64 data. */
  upload: (path: string, data: string) => Promise<FileWriteReceipt>
  /** Hand one workspace file to the browser download manager. */
  download: (path: string) => void
}

/** Full component props: injected operations + the locale seat (the view slot supplies the runtime share). */
export type FilesViewProps = FilesViewInjected & import('@deepseek-ai/dsh-client-ui-slots').PropsLocale<'files'>
