# Fork changelog

Everything built on top of upstream `deepseek-ai/deepseek-harness` in the
`guntur-d/deepseek-harness` fork. Distribution and run instructions live in
[RELEASE.md](RELEASE.md); the day-to-day handoff is
`handoff-dsh-fork-work.md` (repo root, untracked).

## Current capabilities (fork master @ `2e9154ce0b`)

- **Remote web GUI** (`PR #1`): `dsh web` serves the full browser UI on a
  remote host. `--host`, `--trusted-host` (repeatable), and
  `--allow-privileged-remote` extend the browser-trust fence beyond
  loopback; the privileged plane (settings, credentials, agent presets,
  native dialogs, model discovery) opens only to named authorities.
- **Tool-call id uniqueness** (`PR #2`): providers streaming degenerate
  calls can no longer mint colliding tool-call ids.
- **Loop cap** (`PR #3`): a turn ends after consecutive all-error tool
  steps, and the final failure notice carries the last tool error.
- **Persistent memory** (`PR #4`): a cross-session memory store with
  model tools; the standalone `guntur-d/dsh-memory` plugin repo tracks it.
- **Optional run_code description** (`PR #5`): a missing description falls
  back to a title instead of failing the call.
- **Workspace Files panel** (`PR #6`): a `Files` tab next to
  Chat/Trajectory — list, read, bounded edit, upload, and download over
  HTTP (`GET /api/files.download`), strictly workspace-scoped under the
  session's canonical cwd. Demo GIF and provenance on the
  `files-panel-assets` branch.
- **Files before the first message**: the Files tab renders on a blank
  session, so browsing and downloading need no chat round.
- **Settings for privileged remotes**: the boot graph carries each client
  row's evaluated config; remote browsers on privileged authorities get
  host persistence, so Settings (General, Models, Plugins) work from the
  LAN or Tailnet.
- **In-browser configuration editor**: "Open configuration file" opens
  the raw settings document in a modal editor with validated whole-file
  save (`settings.documentRead`/`documentWrite`); the native opener stays
  as a secondary action where a desktop exists.
- **`@` workspace file mentions**: the composer `@` menu scans the
  workspace recursively (configurable budget: `mentionMaxFiles`,
  `mentionMaxDepth`, `mentionIgnoreDirs`), skipping build output, and
  inserts the workspace-relative path for the model's file tools.
- **2 GiB transfer bound** (deployment lever): `filesMaxTransferBytes`
  in the profile patch (default remains 64 MiB).
- **Upstream fix #7** (win32 sandbox): `workspace-write` never grants
  `<drive>:\tmp` on Windows (the POSIX `/tmp` literal was resolved against
  the current drive); **#8** (win32 SIGINT): Ctrl+C exits in ~300ms so
  PowerShell keeps its console.
- **Copy path on plain HTTP**: the Files panel row action routes through
  the shared `writeClipboard` (async Clipboard API with an `execCommand`
  fallback) and reports the boolean result as the copied/copy-failed
  notice — `navigator.clipboard` is undefined on insecure origins, which
  previously threw.

## Chronology

- **2026-08-14** — PRs #1 (remote access), #2 (tool-call ids), #3 (loop
  cap) opened with all gates green; upstream Discussions posts (EN + 中文)
  filed for #161 (tool-call ids), #984 (npm packaging blocker), #1093
  (run_code description), #1419 (loop hang), each referencing the fork
  fix.
- **2026-08-14** — PR #4 (persistent memory) + standalone
  `dsh-memory` plugin repo.
- **2026-08-15** — PR #5 (run_code description) and PR #6 (Files panel,
  with a real-model demo GIF). PR #6 was verified live on a worktree
  server; the agent-authored intermediate states were preserved on
  quarantine branches.
- **2026-08-15** — Fork master established as the single canonical
  version: all six PRs merged and pushed (all show MERGED), worktrees and
  merged branches removed, one server on port 3081 from the main checkout.
- **2026-08-16** — Session-3 fixes: Files tab on blank sessions;
  privileged-remote settings trust (boot-graph config plumbing); 2 GiB
  download bound; fire-and-forget native open (the previous runner held
  the RPC open for the editor's lifetime); in-browser configuration
  editor; recursive `@` file mentions.
- **2026-08-16** — Incident handled: a verification write overwrote
  `~/.dsh/settings.yaml`; the file was reconstructed from the read
  response, the intact credential store, and session logs, and verified
  with a real model round. The model routes use the pateway gateway
  (`api.pateway.ai/v1`) for both `llm-deepseek` and the pi-ai
  `opencode-go` provider.
- **2026-08-16** — Upstream bug fixes merged: PR #7 (sandbox `/tmp` on
  Windows, Discussion #2562) and PR #8 (win32 SIGINT grace, Discussion
  #2568), each reported EN + 中文 on the upstream Discussions.
- **2026-08-16** — Clipboard fix: Copy path works on plain HTTP; the
  component tests now pin both the refused-`execCommand` and
  rejected-Clipboard-API cases to the localized failure notice.

## Operational notes

- Launch: `~/dsh-files-web.sh` (setsid, `DISPLAY=:0` for native opens,
  LAN + Tailnet trusted hosts).
- Config levers: `~/.dsh/profiles/web/cordis.patch.yml` (2 GiB transfer
  bound; `ui-files` mention budget; plugin enable/disable).
- Keys: `~/.dsh/.credentials.yaml` (DEEPSEEK_API_KEY,
  OPENCODE_GO_API_KEY); the GUI key editor writes here (Models → Edit →
  API key → Apply).
- Build gotchas: the root `lib/types/{index,invariant,startup}.js`
  artifacts are stale-but-required for tsdown's `dsh-root` entry (recreate
  `export {}` stubs if a clean removes them); `packages/client/modules`
  compiles under `tsconfig.client.json`; the 3081 server runs sources via
  tsx.
- Known environment limits: `test:web` e2e suites time out uniformly in
  this sandbox (environmental; jsdom assembled-boot snapshots pass).
