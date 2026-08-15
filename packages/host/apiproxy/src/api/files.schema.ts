/**
 * files domain zod schemas (names derived from map keys: filesListRequestSchema /
 * filesListValueSchema). SessionId brand cast point: sessionIdSchema, and only
 * there (hosted in sessions.schema). Paths are workspace-relative by contract:
 * an absolute spelling or a `..` traversal segment is rejected here (fast,
 * clear 400), while the implementation's canonical containment check remains
 * the authoritative boundary against escapes the schema cannot see (symlinks).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** Absolute path spellings (POSIX root, Windows root, drive letter) — workspace-relative by contract. */
const ABSOLUTE_PATH = /^[/\\]|[A-Za-z]:[/\\]/

/** A `..` traversal segment — rejected at the wire; containment re-checks the resolved path. */
const PARENT_SEGMENT = /(^|[/\\])\.\.([/\\]|$)/

/**
 * One workspace-relative path: non-empty, not absolute, no traversal segments.
 * The empty string is reserved for the workspace root in list payloads only.
 */
export const workspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(path => !ABSOLUTE_PATH.test(path), { message: 'path must be workspace-relative' })
  .refine(path => !PARENT_SEGMENT.test(path), { message: 'path must not traverse outside the workspace' })

/** Base64 data: canonical alphabet plus optional padding, length a multiple of four. */
export const base64DataSchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, { message: 'data must be base64' })
  .refine(data => data.length % 4 === 0, { message: 'data must be a whole number of base64 groups' })

/** files.list request: the owning session and an optional workspace-relative directory. */
export const filesListRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: workspaceRelativePathSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'files.list'>>>

/** files.list value: one directory level plus its truncation flag. */
export const filesListValueSchema = z.object({
  path: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    type: z.union([z.literal('file'), z.literal('directory'), z.literal('other')]),
    size: z.number().int().nonnegative().optional(),
  })),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'files.list'>>>

/** files.read request: the owning session and the workspace-relative file path. */
export const filesReadRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: workspaceRelativePathSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'files.read'>>>

/** files.read value: bounded decoded content, the full size, and the truncation flag. */
export const filesReadValueSchema = z.object({
  content: z.string(),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'files.read'>>>

/** files.write request: the owning session, the file path, and the full new text. */
export const filesWriteRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: workspaceRelativePathSchema,
  content: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'files.write'>>>

/** files.upload request: the owning session, the file path, and the base64 data. */
export const filesUploadRequestSchema = z.object({
  sessionId: sessionIdSchema,
  path: workspaceRelativePathSchema,
  data: base64DataSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'files.upload'>>>

/** files.write / files.upload value: the shared write receipt. */
export const filesWriteValueSchema = z.object({
  operation: z.union([z.literal('create'), z.literal('update')]),
  version: z.string(),
  bytes: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<ResponseValue<'files.write'>> & Wire<ResponseValue<'files.upload'>>>
