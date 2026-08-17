# DeepSeek Harness — guntur-d distribution

> Everything built in this fork, with the full chronology, is logged in [CHANGELOG.md](CHANGELOG.md).

A maintained fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) with additional features for the **remote-server use case** (harness on a server, operator on the browser). Upstream does not accept external feature PRs, so these live here as a source distribution.

## Delta vs upstream

| Feature | Where | Docs |
|---|---|---|
| Remote server access: `--host <IP> --trusted-host <IP> [--allow-privileged-remote]`, browser-safe UUIDs over plain HTTP, LAN/Tailnet reachable GUI | PR #1 (`feat/remote-dsh-web-server-access`) | [Agent Note](.agents/notes/implemented/feature/2026-08-14-remote-dsh-web-server-access.md) |
| Tool-call id fix: degenerate streams no longer fail the turn with `INVALID_REQUEST: Duplicate value for 'tool_call_id'` | PR #2 (`fix/tool-call-id-uniqueness`) | [Agent Note](.agents/notes/implemented/bug-fix/2026-08-14-tool-call-id-collision.md) |
| Loop cap: `maxConsecutiveToolFailures` ends the failing-tool retry loop | PR #3 (`fix/tool-failure-loop-cap`) | [Agent Note](.agents/notes/implemented/bug-fix/2026-08-14-consecutive-tool-failure-loop-cap.md) |
| Persistent cross-session memory: `ctx.memory` + `memory_*` tools + `app:memory` prompt injection | PR #4 (`feat/persistent-memory`) | [Agent Note](.agents/notes/implemented/feature/2026-08-14-persistent-cross-session-memory.md), also standalone: [guntur-d/dsh-memory](https://github.com/guntur-d/dsh-memory) |
| Optional `run_code` description: a missing description falls back to a title instead of failing the call | PR #5 | [CHANGELOG](CHANGELOG.md) |
| Workspace Files panel: `Files` tab with list/read/bounded edit/upload/download over HTTP, workspace-scoped under the session cwd | PR #6 (`feat/files-panel`) | [Agent Note](.agents/notes/implemented/feature/2026-08-15-workspace-files-panel.md) |
| Files before the first message; settings trust for privileged remotes; in-browser configuration editor (`settings.documentRead`/`documentWrite`); recursive `@` workspace file mentions; 2 GiB transfer bound (`filesMaxTransferBytes`) | session 3 | [Agent Note](.agents/notes/implemented/feature/2026-08-16-settings-document-editor.md), [CHANGELOG](CHANGELOG.md) |
| Copy path on plain HTTP: `navigator.clipboard` is undefined on insecure origins, so the row action routes through the shared `writeClipboard` fallback | session 3 | [CHANGELOG](CHANGELOG.md) |
| Upstream bug fixes: win32 sandbox no longer grants `<drive>:\tmp` (POSIX `/tmp` literal); win32 SIGINT exits in ~300 ms so PowerShell keeps its console | PR #7 / PR #8 | [Note](.agents/notes/implemented/bug-fix/2026-08-16-workspace-write-tmp-root-windows.md), [Note](.agents/notes/implemented/bug-fix/2026-08-16-win32-sigint-console.md) |

## Run

```sh
pnpm install
pnpm run build
pnpm dsh --profile web --host <LAN-IP> --trusted-host <LAN-IP> [--allow-privileged-remote]
# browse http://<LAN-IP>:3080 from any machine on the LAN/Tailnet
```

`--allow-privileged-remote` additionally opens the settings/credentials/agent-preset plane to the trusted authority; it requires `--trusted-host`. Wildcard binds (`0.0.0.0`, `::`) stay refused by the CLI.

## Surviving SSH drops

`dsh web` is a foreground process: an SSH drop sends SIGHUP and kills it. The browser GUI reconnects automatically once the server is back, and every session resumes from its durable logs (checkpointed before each model request and tool side effect; an interrupted turn is closed on reload, never lost mid-history).

One-command helper — detects the OS and launches the server detached under the best available keep-alive mechanism:

```sh
./scripts/serve-dsh-web.sh --host <LAN-IP> --trusted-host <LAN-IP> [--allow-privileged-remote]
# prints: launched under tmux (session: dsh-web); reattach with `tmux attach -t dsh-web`
```

- Mechanism priority: **tmux → screen → nohup** (all three work on Linux and macOS; zellij works as a manual alternative: start `zellij -s dsh-web`, run the `pnpm dsh --profile web ...` command inside, detach).
- Re-running the helper reattaches to the existing session instead of duplicating.
- Manual equivalents: `tmux new-session -d -s dsh-web "pnpm dsh --profile web <flags>"`, `screen -dmS dsh-web bash -c "pnpm dsh --profile web <flags>"`, or a systemd unit for a permanent service.
- On macOS, `launchd` (via `launchctl`) can run it as a login service; the helper keeps to tmux/screen/nohup for portability.

## Sync with upstream

```sh
git fetch origin
git merge --ff-only origin/master        # keep master current
# merge-forward each PR branch (bottom-up for the stacked fix branches)
```

## Relationship to upstream

Upstream's CONTRIBUTING.md does not accept external PRs; bug reports flow through GitHub Discussions with fix references (tool-call ids #161, npm packaging #984, run_code description #1093, loop hang #1419, sandbox `/tmp` #2562, win32 SIGINT #2568 — each posted EN + 中文). This fork is the maintained home of the feature deltas. Plugin-ecosystem extras (installable via `dsh plugin add`): [dsh-memory](https://github.com/guntur-d/dsh-memory).
