# Agent Note: win32 SIGINT exits fast so PowerShell's console survives

Status: implemented

English | [中文](2026-08-16-win32-sigint-console.zh.md)

## Problem

On Windows a registered `SIGINT` listener answers `CTRL_C_EVENT` itself, so
PowerShell never sees the interrupt; the graceful shutdown then stalls up to
the 5s window and PowerShell 5.1's PSReadLine ends up with dead console input
(no prompt, no echo). Reported upstream (Discussion #2568, EN + 中文).

## Decision

A user interrupt on Windows uses a near-immediate grace
(`WIN32_SIGINT_GRACE_MS = 300`) instead of the full shutdown window,
aligned with vite/npm behavior. The controller's `interrupt()` takes an
optional per-call grace; the SIGINT handler in `profile-boot` passes the
short window on `win32` only — SIGTERM (supervisors) and normal completion
keep the full grace, and the second Ctrl+C still force-exits at once.

## Alternatives considered

**Restore the console input mode before exit.** Rejected: requires native
`GetConsoleMode`/`SetConsoleMode` calls and does not address the stall; the
fast exit matches the established Windows CLI behavior.

**Drop the SIGINT listener on win32.** Rejected: loses the graceful dispose
entirely and the 130 exit code; the short grace keeps both.

## Consequences

- Ctrl+C after `dsh web` on Windows exits in ~300ms and PowerShell keeps its
  prompt.
- Non-Windows behavior is unchanged; the graceful teardown still runs when
  the tree disposes faster than the grace.
