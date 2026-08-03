// Post-checks for inline markdown tokens that a single-pass tokenizer regex
// cannot express on its own.

/**
 * True when a `_…_` / `__…__` token sits inside a word (snake_case, dunder
 * tails). CommonMark treats intraword underscores as literal text; rejecting
 * the token also keeps file paths like src/foo_bar.ts whole for detection.
 */
export function isIntrawordUnderscoreToken(text: string, index: number, token: string): boolean {
  if (!token.startsWith('_')) {
    return false
  }
  const prev = index > 0 ? text[index - 1]! : ''
  const next = text[index + token.length] ?? ''
  return /\w/.test(prev) || /\w/.test(next)
}

/**
 * Split sentence punctuation off an autolinked URL tail ("see https://x.com/a."),
 * keeping a trailing ')' only when the URL itself opened a paren.
 */
export function trimAutolinkTrailingPunctuation(url: string): { url: string; trailing: string } {
  let end = url.length
  while (end > 0) {
    const char = url[end - 1]!
    if ('.,;:!?'.includes(char)) {
      end--
      continue
    }
    if (char === ')') {
      const body = url.slice(0, end)
      const opens = body.split('(').length - 1
      const closes = body.split(')').length - 1
      if (closes > opens) {
        end--
        continue
      }
    }
    break
  }
  return { url: url.slice(0, end), trailing: url.slice(end) }
}
