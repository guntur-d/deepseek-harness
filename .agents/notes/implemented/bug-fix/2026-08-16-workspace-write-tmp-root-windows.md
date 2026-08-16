# Agent Note: workspace-write fence no longer grants <drive>:\tmp on Windows

Status: implemented

English | [中文](2026-08-16-workspace-write-tmp-root-windows.zh.md)

## Problem

`writableRoots()` (`packages/sandbox/sandbox/src/roots.ts`) unconditionally
included the POSIX literal `'/tmp'` in the `workspace-write` allow-list. On
Windows `realpathSync.native('/tmp')` resolves against the process's current
drive, so when `<drive>:\tmp` exists the in-process fs fence admitted
anything under it as a writable root. Reported upstream (Discussion #2562,
EN + 中文).

## Decision

The POSIX `/tmp` spelling is POSIX-only. `os.tmpdir()` already carries the
platform temp area on every platform, so on `win32` the literal is dropped
entirely; the derivation takes an injectable platform name so the
cross-platform behavior is pinned by test on any host. Every enforcement
dialect (Seatbelt profile, fs-sandbox fence) derives from the same function,
so the fence and the native profiles cannot drift.

## Alternatives considered

**Keep `/tmp` but resolve it to the Windows temp.** Rejected: the literal has
no Windows meaning; `os.tmpdir()` is the real temp area and was already
granted, so the extra root only widened the fence.

## Consequences

- Windows `workspace-write` sandboxes no longer write outside the workspace
  and the real temp area.
- POSIX behavior is unchanged (the literal still resolves to the shared
  `/tmp`).
