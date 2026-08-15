/**
 * downloads domain zod schemas. The download surface has no wire
 * envelope: the request arrives as query parameters (all strings), so its
 * request schema parses the raw query-parameter object into the method's
 * exact request shape. SessionId brand cast point: sessionIdSchema, and only
 * there (hosted in sessions.schema like every other cast).
 */

import { z } from 'zod'
import type { DownloadsApi } from './downloads.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/**
 * session.export query params → the sessionLog request. `includeDescendants`
 * accepts exactly `true`/`false`/absent; any other value is rejected (400) so
 * a misspelled flag cannot silently under-export.
 */
export const sessionLogQuerySchema = z
  .object({
    sessionId: sessionIdSchema,
    includeDescendants: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
  .transform(query => ({
    sessionId: query.sessionId,
    ...(query.includeDescendants === 'true' ? { includeDescendants: true } : {}),
  })) satisfies z.ZodType<Parameters<DownloadsApi['sessionLog']>[0]>

/** Absolute path spellings (POSIX root, Windows root, drive letter) — workspace-relative by contract. */
const ABSOLUTE_PATH = /^[/\\]|[A-Za-z]:[/\\]/

/** A `..` traversal segment — rejected at the wire; containment re-checks the resolved path. */
const PARENT_SEGMENT = /(^|[/\\])\.\.([/\\]|$)/

/**
 * files download query params → the workspaceFile request. The path is
 * workspace-relative by the same contract as the files RPC domain.
 */
export const workspaceFileQuerySchema = z
  .object({
    sessionId: sessionIdSchema,
    path: z.string().min(1).max(4096)
      .refine(path => !ABSOLUTE_PATH.test(path), { message: 'path must be workspace-relative' })
      .refine(path => !PARENT_SEGMENT.test(path), { message: 'path must not traverse outside the workspace' }),
  }) satisfies z.ZodType<Parameters<DownloadsApi['workspaceFile']>[0]>
