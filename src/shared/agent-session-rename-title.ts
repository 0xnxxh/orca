// Why: Claude publishes a deliberate `/rename` and its auto-generated task
// summaries on the same OSC title channel, so the live title alone cannot say
// which one arrived. Only the transcript separates them — `custom-title` for
// the rename, `ai-title` for the summary. Orca records the latest deliberate
// rename on the tab so title resolution can rank it above the first-prompt
// generated title, the same rung `isMeaningfulOpenCodeTerminalTitle` occupies.
import { stripLeadingAgentTitleDecorationOrEmpty } from './agent-title-decoration'

/** Cheap prefilter for transcript readers before they buffer or parse a line. */
export const CLAUDE_CUSTOM_TITLE_RECORD_MARKER = '"custom-title"'

/**
 * The session's current deliberate rename from Claude transcript lines, or null
 * when none survives. Later records win; an empty `customTitle` is Claude
 * clearing the name, which must fall back to Orca's generated title.
 */
export function readClaudeSessionRenamedTitle(lines: Iterable<string>): string | null {
  let renamedTitle: string | null = null
  for (const line of lines) {
    // Why: transcripts are mostly large message records; skip the JSON parse
    // unless the line can carry the marker.
    if (!line.includes(CLAUDE_CUSTOM_TITLE_RECORD_MARKER)) {
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== 'object') {
      continue
    }
    const { type, customTitle } = record as { type?: unknown; customTitle?: unknown }
    if (type !== 'custom-title') {
      continue
    }
    renamedTitle = typeof customTitle === 'string' ? customTitle.trim() || null : null
  }
  return renamedTitle
}

/**
 * True when the pane's live OSC title still carries the recorded deliberate
 * rename. Matching (rather than substituting the recorded name) keeps the label
 * self-correcting: once the agent moves the title elsewhere, the rename stops
 * outranking the generated title.
 */
export function isAgentRenamedTerminalTitle(
  liveTitle: string | null | undefined,
  agentRenamedTitle: string | null | undefined
): boolean {
  const renamedTitle = agentRenamedTitle?.trim()
  const title = liveTitle?.trim()
  if (!renamedTitle || !title) {
    return false
  }
  // Why: the live title carries the agent's status glyph ("✳ billing-fix").
  return title === renamedTitle || stripLeadingAgentTitleDecorationOrEmpty(title) === renamedTitle
}
