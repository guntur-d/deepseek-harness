# Agent Note: Remote access for the `dsh web` GUI

Status: implemented

English | [中文](2026-08-14-remote-dsh-web-server-access.zh.md)

## Problem

`dsh web` serves only the operator's local machine. The webserver `host` schema was a closed two-literal union (`127.0.0.1` or `0.0.0.0`), and the CLI refused the all-interfaces wildcard literal for safety, so a GUI running on a remote server could not be reached over a LAN or Tailnet IP. On top of the reachability gap, the browser half called `crypto.randomUUID()` — a secure-context-only API — for RPC and draft ids, which throws over plain HTTP on a non-localhost origin, and the privileged method plane (settings, credentials, agent presets, native dialogs) was hard-pinned to loopback with no operator path to open it.

## Decision

Remote serving is an explicit, layered opt-in, and plain-HTTP browser code never touches `crypto.randomUUID()`:

- `randomUuid()` generates an RFC 4122 v4 UUID from `crypto.getRandomValues()`, which browsers expose on insecure origins. It lives in the inline-safe wire layer `dsh-host-apiproxy/api` and is the single minting helper for `AbstractApiClient.mintRpcId`, the connection RPC channel, the fixture carrier, and `ui-conversation`'s draft attachment ids.
- The webserver `host` schema accepts any non-empty bind address. A specific IP literal or hostname binds only that interface; the wildcard literals `0.0.0.0` (all IPv4) and `::` (all IPv6) remain refused by the CLI.
- The `/api` browser-trust fence still requires the served authority in `--trusted-host`. A specific bind without a matching trusted authority serves the page but refuses every `/api` call with 403.
- `--allow-privileged-remote` (which requires `--trusted-host`) opens the privileged plane — settings, credentials, agent presets, native dialogs, model discovery — to exactly the trusted authorities. Without it the plane stays loopback-only.
- The runtime URL line prints the reachable bind-host URL for a specific bind, and a loopback-only hint (`to serve the network, restart with: dsh web --host <LAN IP> --trusted-host <LAN IP>`) when the server binds loopback.

## Alternatives considered

**Ship a `crypto.randomUUID` polyfill in the frontend shell.** Rejected: a global Web-API monkeypatch is a magic fix; the targeted helper keeps every call site explicit.

**Export `randomUuid` from `dsh-client-connection/client`.** Rejected: the client bundle purity gate forbids cross-plugin value imports of a loader row with runtime identity. `dsh-host-apiproxy/api` is the documented inline-safe wire layer that client bundles already value-import.

**Allow `--host 0.0.0.0`.** Rejected: all-interfaces binding exposes remote code execution to every interface without an operator decision. A specific address binds one interface.

**Auto-trust the specific bind host.** Rejected: one flag would silently expose the agent on that interface. The fence requires the authority be named twice, in `--host` and `--trusted-host`.

**Reuse `--trusted-host` for the privileged plane.** Rejected: `trustedHosts` is a DNS-rebinding fence, not authentication, and the configuration/secret plane stays loopback-same-origin until real authentication exists. A separate `--allow-privileged-remote` makes the secret-plane exposure its own explicit decision.

## Consequences

Serving `dsh web` from a remote server is `dsh web --host <IP> --trusted-host <IP> [--allow-privileged-remote]` — an explicit, auditable opt-in for each plane. Plain-HTTP LAN/Tailnet access works because no browser-executed code calls `crypto.randomUUID()`. The operator remains responsible for the network exposure: any reachable trusted authority can drive the agent, and with `--allow-privileged-remote` can read and write the configuration and secret store. The wildcard binds stay unavailable from the CLI.
