// Leading status decorations that coding agents prepend to their OSC title —
// Claude's '✳', Gemini's glyphs (✦ ⏲ ◇ ✋), braille and quarter-circle spinners,
// and Claude's '. '/'* ' working/idle prefixes. Once the tab bar shows the
// provider icon, this leading glyph reads as a redundant second icon, so strip
// it from the displayed title. Scoped to titles we already know belong to an agent.
//
// Why the trailing selector: Qwen Code writes its glyphs text-presentation-qualified
// (`◐` + U+FE0E). Left behind, that invisible character stays glued to the front of
// the title and stops the name matching its identity frame - so absorb it per glyph
// rather than inside the class, where it would read as a combining sequence. The lone
// selector branch catches what callers leave behind when they strip a spinner themselves
// (isQuarterCircleSpinnerOnlyAgentTitle), which would otherwise orphan it at the front.
const LEADING_AGENT_TITLE_DECORATION_RE =
  // eslint-disable-next-line no-control-regex -- intentional unicode status-glyph ranges
  /^(?:(?:[✳✦⏲◇✋⠀-⣿◐-◓][\uFE0E\uFE0F]?)+|[\uFE0E\uFE0F]+|[.*]\s)\s*/

export function stripLeadingAgentTitleDecorationOrEmpty(title: string): string {
  return title.replace(LEADING_AGENT_TITLE_DECORATION_RE, '').trimStart()
}

export function stripLeadingAgentTitleDecoration(title: string): string {
  const stripped = stripLeadingAgentTitleDecorationOrEmpty(title)
  // Why: never return empty — a title that is *only* a status glyph should keep
  // its original text rather than collapse to a blank tab label.
  return stripped.length > 0 ? stripped : title
}
