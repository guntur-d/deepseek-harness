# Agent Note: Persistent cross-session memory

Status: implemented

English | [中文](2026-08-14-persistent-cross-session-memory.zh.md)

## Problem

A new session starts with only the workspace instructions and the conversation at hand: durable facts the operator or an earlier session established (a port, a preference, a non-obvious project fact) had to be re-discovered or re-stated every time. Session persistence resumes one session by id, compaction summarizes within one session, and `session-reference` recalls another session only on demand — nothing automatically carried selected facts forward.

## Decision

A workspace-scoped memory store behind a capability seam: `ctx.memory` (Service Definition + provider) stores facts durably on the storage-domain seam (`memory` domain, `entries` table keyed by id, routed to the deployment's `json` or `sqlite` backend); `dsh-memory-tool` (Consumer) exposes `memory_write`/`memory_list`/`memory_search`/`memory_forget` and injects a bounded `app:memory` prompt section (order 50, up to `maxContextEntries` lines) into every session in the same workspace. The model decides what is worth saving, guided by the `memory_write` description; there is no automatic summarization. Every save/forget also appends a `memory/write`/`memory/forget` session event, so the per-session log stays consistent with the cross-session store. Entries carry a monotonic `seq` minted on the domain's atomic write chain, so ordering and eviction stay deterministic when wall-clock timestamps tie. The workspace scope is the owning session's `cwd` (one shared `<no-cwd>` scope otherwise), so projects never share memory.

## Alternatives considered

**A plain `MEMORY.md` file in the workspace.** Rejected: concurrent sessions appending to one file race and lose writes, and there is no structure for search or bounded injection. The storage domain gives atomic writes, validation, and a swappable backend.

**Automatic end-of-turn digesting.** Rejected for the default: summarizing every turn costs tokens and captures noise. The model-driven tool lets the operator's phrasing and the tool description decide what matters; a digest provider can be added later without changing the seam.

**An MCP-backed store (MemPalace/Obsidian) as the default.** Rejected: an external server and embedding pipeline are heavy for a human-scale store the harness already has primitives for. The provider seam leaves an MCP-backed provider as a drop-in later.

**Injection as a logged `user/message` context.** Rejected: a system-prompt section keeps the memory fresh per request and is recorded per request in `request/header`, satisfying the model-visible⟺logged invariant without append/replace machinery.

## Consequences

Facts saved in one session are visible to later sessions in the same workspace through the bounded prompt section and the tools. Memory is bounded per workspace (eviction) and per entry (text cap), both validated config. The store is the cross-session authority; a lost storage medium loses memory even though the per-session `memory/*` events survive. No memory is ever injected automatically without the model having written it (the section is empty until the first save).
