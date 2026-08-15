import type { AgentStatus } from './agent-title-core'

/**
 * Kilo CLI writes a native terminal title that already carries its identity AND
 * its turn state, so Orca reads both from one declared grammar instead of
 * inferring either from decoration.
 *
 * Measured on `@kilocode/cli` 7.4.22 (raw `OSC 0` capture plus the shipped
 * title builder): the home screen emits the bare base `Kilo CLI`; inside a
 * session it emits `${glyph} Kilo CLI | ${session title}` where the session
 * title is truncated by Kilo to 40 characters. The glyph set is chosen by
 * Kilo's `title_icon` config — `unicode`, `emojis`, or `none`, and `none`
 * renders no glyph at all, so an undecorated frame must stay valid evidence.
 *
 * Deliberately provider-owned rather than a branch inside OpenCode's matcher:
 * Kilo is an OpenCode fork and shares this title *shape*, but its base marker,
 * glyph tables and indicator precedence are its own, and OpenCode panes must
 * not shift behavior when Kilo's vocabulary grows.
 */
export type KiloTitleIndicator = 'working' | 'attention' | 'finished' | 'none'

// Kilo's `title_icon` tables: `unicode` first, then `emojis`. Kept per-indicator
// so a title reports what Kilo meant, not merely that it was decorated.
const KILO_WORKING_GLYPHS = ['◔', '\u{1f4ad}'] // ◔ 💭
const KILO_ATTENTION_GLYPHS = ['⚠', '\u{1f536}'] // ⚠ 🔶
const KILO_FINISHED_GLYPHS = ['✓', '✅'] // ✓ ✅
const KILO_GLYPHS = [...KILO_WORKING_GLYPHS, ...KILO_ATTENTION_GLYPHS, ...KILO_FINISHED_GLYPHS]

const KILO_GLYPH_CLASS = `[${KILO_GLYPHS.join('')}]`

// Why: wrappers may prepend an SSH/tmux label, and Kilo may prepend one status
// glyph. A glyph-led segment from another agent must not be read as a wrapper.
// The tail is either nothing (home screen) or Kilo's ` | <session title>`;
// anything else — `Kilo CLI Configuration Reference` in a pager, say — is prose
// that merely mentions the CLI and must not mint an agent row.
const KILO_NATIVE_TITLE_RE = new RegExp(
  `^\\s*(?:(?!${KILO_GLYPH_CLASS})[^|]+? \\| )?(${KILO_GLYPH_CLASS})?\\ufe0f?\\s*Kilo CLI(?: \\|[ \\t]+\\S.*)?\\s*$`,
  'u'
)

/** Kilo's own indicator for a native title, or `null` when the title is not Kilo's. */
export function parseKiloTitleIndicator(
  title: string | null | undefined
): KiloTitleIndicator | null {
  if (!title) {
    return null
  }
  const match = KILO_NATIVE_TITLE_RE.exec(title)
  if (!match) {
    return null
  }
  const glyph = match[1]
  if (!glyph) {
    return 'none'
  }
  if (KILO_WORKING_GLYPHS.includes(glyph)) {
    return 'working'
  }
  if (KILO_ATTENTION_GLYPHS.includes(glyph)) {
    return 'attention'
  }
  return 'finished'
}

export function isKiloNativeTitle(title: string | null | undefined): boolean {
  return parseKiloTitleIndicator(title) !== null
}

/**
 * Kilo's indicator mapped onto Orca's title status.
 *
 * `attention` is Kilo's single "needs the human" indicator — it covers a pending
 * permission, question, suggestion, network prompt or plan approval (and a session
 * that went offline), so it reads as `permission` rather than as work in flight.
 */
export function detectKiloTitleStatus(title: string | null | undefined): AgentStatus | null {
  const indicator = parseKiloTitleIndicator(title)
  if (!indicator) {
    return null
  }
  if (indicator === 'working') {
    return 'working'
  }
  return indicator === 'attention' ? 'permission' : 'idle'
}
