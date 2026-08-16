/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/**
 * Default cap on consecutive agent steps whose tool calls all error. A model
 * that keeps emitting failing calls (a malformed tool name, an unavailable
 * tool) would otherwise drive the loop without bound; past this count the turn
 * ends with a logged notice.
 */
export const DEFAULT_MAX_CONSECUTIVE_TOOL_FAILURES = 3
