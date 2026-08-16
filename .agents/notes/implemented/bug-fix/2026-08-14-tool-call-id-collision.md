# Agent Note: Collision-safe tool-call ids on degenerate provider streams

Status: implemented

English | [中文](2026-08-14-tool-call-id-collision.zh.md)

## Problem

Some providers occasionally stream a tool call with an empty `id` and `name` — a degenerate call the model emits when it tries to use a tool it does not have. The DeepSeek and pi-ai adapters mapped a missing provider id to `CallId('')`, so every such call in a conversation carried `tool_call_id: ''`. When the turn re-sent the accumulated history (after folding the `unknown tool ""` error into a tool result), two tool messages with the same empty `tool_call_id` made the provider reject the request with `INVALID_REQUEST: Duplicate value for 'tool_call_id'`, failing the turn.

## Decision

`BlockAssembler` guarantees every assembled tool-call block a non-empty id. A provider-supplied non-empty id is authoritative; a missing or empty id gets a fallback salted with a per-message discriminator the agent loop passes as `turn-step`, plus the block index, so `call-{turn}-{step}-{index}` is unique across the whole session history. The repair covers both entry paths — the delta assembly and the `block-end`-delivered block. The agent loop constructs `BlockAssembler` with `streamSalt: `${turn}-${step}``; adapters stay unchanged and their empty `''` ids are repaired at assembly.

## Alternatives considered

**Mint a random id in each adapter.** Rejected: it fixes one adapter at a time and the assembler is the single canonical assembly point, so the guarantee should live there; a per-message salt also keeps the repaired ids deterministic.

**Drop degenerate tool calls outright.** Rejected: the loop already folds the `unknown tool ""` error into a tool result so the model learns the call was invalid; the defect was the colliding id removing the request entirely, not the call itself.

## Consequences

A conversation that triggers degenerate empty-id tool calls now continues instead of failing the turn with a provider `INVALID_REQUEST`. Repaired ids are deterministic per message (turn/step), so the logged assistant message and any stream re-assembly stay in agreement. Non-degenerate provider ids are unchanged.