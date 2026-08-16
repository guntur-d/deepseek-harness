# Agent Note: Workspace-scoped Files panel (browse, edit, upload, download)

Status: implemented

English | [中文](2026-08-15-workspace-files-panel.zh.md)

## Problem

The GUI offers no browser-side file surface for a session's workspace: host-side tools can read and write files, but the operator at the browser cannot list, preview, edit, upload, or download them. The fork handoff scoped the gap as a workspace-scoped Files right-panel — browsing the active session's `cwd` within the workspace boundary, deliberately not a privileged surface.

## Decision

A new `files` RPC domain on `ApiProxy` (`files.list`/`read`/`write`/`upload`), session-addressed with workspace-relative paths, plus a `GET /api/files.download` byte surface mirroring session export (a `HEAD` preflight, then the browser download manager). The host is the authority: the session's canonical `header.cwd` is the workspace root, and every path resolves through the fs seam (`fs.resolve` realpaths symlinks) and must pass `fs.contains` — anything else fails `file-outside-workspace`. Writes and uploads carry an explicit `workspace-write` policy rooted at the canonical workspace so a sandboxing backend's fence agrees with the containment gate; uploads ride the JSON envelope as base64 so the carrier's cross-site write fence still covers them. Reads return bounded text (default 1 MiB, code-point-aligned prefix plus `truncated`), listings cap at 2000 entries, transfers at 64 MiB; all three bounds are validated `ApiProxyService` config keys. The fs seam gained the byte mirror of `readBytes`: abstract `writeBytes` implemented by `dsh-fs-local`, `dsh-fs-sandbox`, and `dsh-fs-e2b`.

The client half is a new plugin package `@deepseek-ai/dsh-client-ui-files`: it registers a `files` tab (order 20) in the conversation view ring, and `FilesView` receives everything through injected session-bound operations (its contract) — it never sees a session id, the connection handle, or ctx. A keyless web e2e golden (`apps/web/tests/files-panel.e2e.ts`) seeds a real session, creates real files in its workspace, drives the tab through listing and the bounded editor, and snapshots the panel ARIA.

## Alternatives considered

**FTP/SFTP endpoint tools (handoff option A).** Rejected: the operator gap is browser-side transfer for the harness's own workspace; external-server connectivity stays deferred until a concrete need.

**A raw-body upload route.** Rejected: browsers send cross-site "simple" POSTs without a CORS preflight, which would punch a hole in the `application/json` 415 write fence; base64 inside the envelope keeps uploads under the same fence as every other method.

**A privileged remote surface.** Rejected: the panel is workspace-scoped by design and must not depend on `--allow-privileged-remote`.

## Consequences

The panel browses each session's own workspace root; nothing can list, read, write, upload, or download outside it, and editing a truncated read is refused. The `files` domain and download surface are documented in the apiproxy README and the ui-files package README; the `writeBytes` seam addition is documented on the filesystem subsystems page. The panel's navigation, open-file, and draft state are component-local and do not survive a session switch.
