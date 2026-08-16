const LINK_REFERENCE_DEFINITION_LINE = /^( {0,3})\[(?=[^\]\n]*\]:)/
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/

/**
 * A user turn is prose, not authored Markdown. CommonMark reads a line like
 * `[Image #1]: /tmp/a.png` as a link reference definition and renders nothing at
 * all, so a marker the transcript rules preserve would still vanish on screen.
 * Escaping the opening bracket is output-neutral for every other line.
 */
export function escapeNativeChatUserMarkdown(markdown: string): string {
  if (!markdown.includes(']:')) {
    return markdown
  }
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE_LINE.test(line)) {
        inFence = !inFence
        return line
      }
      return inFence ? line : line.replace(LINK_REFERENCE_DEFINITION_LINE, '$1\\[')
    })
    .join('\n')
}
