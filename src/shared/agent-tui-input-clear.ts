// Clearing an agent TUI's input buffer when it may hold MORE THAN ONE line.
//
// Shared by desktop native chat and mobile: the law below is a property of the
// agent TUIs (Claude Code, codex), not of either client.

/** Ctrl+U — kills to the START OF THE CURRENT LOGICAL LINE in an agent TUI. */
export const AGENT_TUI_CLEAR_INPUT_LINE = '\x15'

/**
 * How many Ctrl+U an N-line buffer costs: **2N-1**.
 *
 * Measured on real PTYs against Claude Code and codex; both agree exactly. Each
 * Ctrl+U kills to the start of the current logical line; when that line is
 * ALREADY EMPTY the next one deletes the newline and joins to the previous line.
 * So N kills + (N-1) joins = 2N-1. (N=2 needs 3; N=4 with 5 leaves residue;
 * N=4 with 7 is clean.)
 *
 * Rejected alternatives — all measured, do not "fix" this by reaching for them:
 * - **Ctrl+A, Ctrl+K, Ctrl+U** (the sequence a comparable agent-TUI wrapper uses)
 *   does NOT clear a multi-line buffer. Ctrl+A/Ctrl+K act inside the CURRENT
 *   logical line only, so earlier lines survive AND the cursor is left at the end
 *   of the previous line — the next paste glues straight onto it, strictly worse
 *   than a single Ctrl+U.
 * - **Esc** does nothing at all to the buffer in either TUI.
 * - **A fixed repeat count** is silently wrong: 5 clears 3 lines but leaves
 *   residue at 4. The count must come from the line count.
 *
 * Only LOGICAL newlines cost anything: one 300-char line wrapping several visual
 * rows still dies to a single Ctrl+U, so callers must not count wrapped rows.
 */
export function buildAgentTuiClearInput(lineCount: number): string {
  const lines = Math.max(1, Math.min(AGENT_TUI_CLEAR_MAX_LINES, Math.floor(lineCount)))
  return AGENT_TUI_CLEAR_INPUT_LINE.repeat(2 * lines - 1)
}

/**
 * Headroom over the line count Orca knows about. The text Orca injected is a
 * LOWER BOUND on what the buffer holds — the user can also type straight into
 * the TUI line — so the count is deliberately biased upward. Overshoot is free:
 * 41 Ctrl+U against a 1-line buffer measured perfectly clean on both agents,
 * and an undershoot is what leaves residue to glue onto the next message.
 */
export const AGENT_TUI_CLEAR_LINE_SLACK = 8

/** Bounds the burst so a pathological draft cannot emit an unbounded write. */
export const AGENT_TUI_CLEAR_MAX_LINES = 40

/** Widest burst we ever send — the remedy when a clear is not observed to land. */
export const AGENT_TUI_CLEAR_INPUT_MAX = buildAgentTuiClearInput(AGENT_TUI_CLEAR_MAX_LINES)

/** Logical lines in `text`. Visual wrapping is irrelevant to the clear cost. */
export function countAgentTuiInputLines(text: string): number {
  return text.split(/\r\n|\r|\n/).length
}

/** Clear bytes for a buffer believed to hold `text`, with slack for TUI-side edits. */
export function buildAgentTuiClearInputForText(text: string): string {
  return buildAgentTuiClearInput(countAgentTuiInputLines(text) + AGENT_TUI_CLEAR_LINE_SLACK)
}
