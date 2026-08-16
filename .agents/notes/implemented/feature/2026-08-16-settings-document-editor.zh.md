# Agent Note: 浏览器内配置文件编辑器

状态：已实现

中文 | [English](2026-08-16-settings-document-editor.md)

## 问题

The Settings → General "Open configuration file" action handed the document to the platform's native opener. On headless or login-screen hosts (no graphical session for the server's user) the hand-off can never display a window, and the RPC still reported `opened: true` — the open was spawned, not displayed. The operator had no way to read or edit the configuration document from the browser at all.

## 决策

A browser-side editor over the settings document, available everywhere, with the native open demoted to a secondary affordance:

- **Host surface**: two new privileged RPCs, `settings.documentRead` and `settings.documentWrite`. Read returns the raw document text plus its Host path (display only — the browser never writes through the path). Write replaces the whole document after the provider validates it (the same parse the boot-time load applies); an invalid replacement fails before any byte touches disk. Both are in `PRIVILEGED_METHODS` like the rest of the settings plane.
- **Seam**: `SettingsProvider` gained abstract-capable `readDocument`/`writeDocument`; the file provider (`dsh-settings-file`) implements them on its single exclusive operation chain — the write runs under the cross-process writer lock, sets the self-write suppression cache, and publishes the parsed replacement. Non-file providers keep the `undefined`/throw defaults.
- **Client**: the `SettingsDocumentStore` gained an editor state machine (open/read, stage, save, close); `SettingsDocumentAction` now opens the editor instead of the native open, and `SettingsDocumentModal` renders the overlay: the Host path, a monospace textarea with the raw document, Save/Cancel, and — only when `host.describe` reports `canOpenPath` — a secondary "Open configuration file" button that still runs the native open.

The whole-file replace is deliberate: the editor shows the exact document the provider reads, so a save must reproduce it verbatim; the Host's validation gate is what keeps a malformed edit from replacing a working document.

## 备选方案

**Fix only the native open** (start the server with `DISPLAY`). Rejected as the primary answer: the capability is host-desktop-dependent and untestable on headless deployments; the browser editor is the portable surface, and the native open remains one click away where it can work.

**Gated fallback (editor only when `canOpenPath` is false).** Rejected: capability detection is env-based and this box reports a display that cannot actually show windows (login-screen X server); an always-available editor removes the guesswork, and the secondary native affordance preserves the desktop path.
