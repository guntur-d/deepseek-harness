# Agent Note: Bound consecutive all-error tool steps

Status: implemented

English | [中文](2026-08-14-consecutive-tool-failure-loop-cap.zh.md)

## Problem

A model that keeps emitting failing tool calls drives the agent step loop without bound. The observed trigger: the model tried to follow an injected AGENTS.md instruction ("read RULES.md") and emitted tool calls with an empty name; each executed as `unknown tool ""`, the error was folded back into history, and the model retried with another failing call. The turn kept issuing model requests until the operator clicked stop — an unbounded, expensive retry loop.

## Decision

The agent loop tracks consecutive steps whose tool calls all error, and past `maxConsecutiveToolFailures` (default 3) ends the turn with a logged, model-visible notice instead of issuing another request. A step resets the counter when it produces text or commits at least one successful tool result. The scheduler reports per-step committed-error counts; the loop owns the turn boundary. The counter and the notice are model-visible and therefore logged (`user/message` with a plugin source), so the next turn's history explains why the previous one ended.

## Alternatives considered

**Feed the failing call a more instructive error.** Rejected as the only fix: the model may still retry, so the loop needs a hard bound regardless of error quality.

**End the turn on the first degenerate (empty-name) call.** Rejected: a transient malformed call among valid parallel calls should not discard the valid ones, and a single failure is recoverable; the bound tolerates a few consecutive failures.

**Terminate from a guard plugin.** Rejected: `tools/post-execute` can only accept or block a single call; ending the turn is a loop-owned boundary.

## Consequences

A turn whose steps all error now terminates after the configured count with a visible notice, bounding cost and operator waiting. The cap is a validated `agent-loop` config field (positive integer, default 3), exposed in the Settings section alongside `maxParallelToolCalls`. Genuine multi-step tool sequences are unaffected: any step with a successful tool result or plain text resets the counter.
