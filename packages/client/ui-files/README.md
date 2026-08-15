# @deepseek-ai/dsh-client-ui-files

Workspace-scoped Files panel: a conversation view tab (`Files`, next to Chat /
Trajectory) browsing the **active session's workspace root** — list, open and
edit text files, upload new files, and download any file. The host owns the
boundary: every operation resolves the session's canonical `header.cwd` and
rejects any workspace-relative path that escapes it (`file-outside-workspace`),
so this surface is workspace-scoped, **not privileged** — it never needs
`--allow-privileged-remote` and can only touch the session's own project.

## Model Experience

The panel is operator-facing; the model never sees it directly. It reads and
writes the same files the model's tools do, through the same `ctx.fs` seam
(the sandboxed backend in the web profile), so a panel edit is byte-identical
to a model `write` under `workspace-write` mode. No session-log events are
emitted: the panel is a UI surface, not a model input.

#### KV Cache effect

None: the panel does not touch the model request path.

## Host surfaces consumed

- `files.list` / `files.read` / `files.write` / `files.upload` — the files
  RPC domain (`@deepseek-ai/dsh-host-apiproxy`), session-addressed, all paths
  workspace-relative.
- `GET /api/files.download?sessionId=…&path=…` — the workspace download
  surface (bounded by the deployment's transfer limit; HEAD preflight
  supported, mirroring `session.export`).

## Bounds

- Reads cap at the deployment's text bound; a larger file returns its
  code-point-aligned prefix with `truncated: true`, and the editor refuses to
  edit a truncated view (overwriting it would destroy the tail).
- Writes and uploads fail loud (`file-too-large`) over their bounds before any
  I/O.
- Listings cut at the entry bound with `truncated: true`.

## Known Limitations and Deferred Work

- **No delete, rename, or create-directory actions** — the panel lists, reads,
  writes, uploads, and downloads only; destructive and structural operations
  are out of scope for the first iteration.
- **Text preview only** — binary files are downloadable but not previewable;
  the read path rejects them with `file-not-text`.
- **Upload rides the JSON envelope** (base64), keeping the cross-site write
  fence intact; a streaming raw-body upload route is deferred.

## Development

```sh
pnpm --filter @deepseek-ai/dsh-client-ui-files test   # jsdom component + bundle specs
pnpm --filter @deepseek-ai/dsh-client-ui-files bundle # rebuild lib/client.js
```
