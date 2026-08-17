import type { Processor } from 'unified'

/**
 * Stop CommonMark from reading `[label]: /some/target` as a link reference
 * definition.
 *
 * Definitions render to nothing at all, so on content that is prose rather than
 * authored Markdown — a chat turn the user typed — such a line silently deletes
 * itself. Escaping the bracket in the source text only reaches lines at the top
 * level; a definition inside a list item or blockquote, or one whose label wraps
 * across lines, is still swallowed. Turning the construct off covers every
 * container, and leaves inline links, reference *links*, and GFM intact.
 */
export function remarkDisableDefinitions(this: Processor): undefined {
  const data = this.data()
  const extensions = (data.micromarkExtensions ??= [])
  extensions.push({ disable: { null: ['definition'] } })
  return undefined
}
