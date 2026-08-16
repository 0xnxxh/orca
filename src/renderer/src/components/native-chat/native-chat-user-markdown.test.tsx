import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { escapeNativeChatUserMarkdown } from './native-chat-user-markdown'

function renderedText(content: string): string {
  return renderToStaticMarkup(<CommentMarkdown variant="document" content={content} />)
    .replace(/<[^>]*>/g, '')
    .trim()
}

describe('escapeNativeChatUserMarkdown', () => {
  // The swallow this guards against: without the escape the marker line is a
  // CommonMark link reference definition and the whole turn renders empty.
  it('keeps a marker line the raw Markdown pipeline drops entirely', () => {
    const typed = '[Image #1]: /tmp/a.png'

    expect(renderedText(typed)).toBe('')
    expect(renderedText(escapeNativeChatUserMarkdown(typed))).toBe('[Image #1]: /tmp/a.png')
  })

  it('keeps a definition-shaped line that precedes other prose', () => {
    const typed = '[Image #1]: /tmp/a.png\n\nwhat do you make of it?'

    expect(renderedText(typed)).toBe('what do you make of it?')
    expect(renderedText(escapeNativeChatUserMarkdown(typed))).toBe(
      '[Image #1]: /tmp/a.png\nwhat do you make of it?'
    )
  })

  it.each([
    'keep [Image #1] literal',
    '[Image #1] describe this',
    'here is my note\n[Image #1]: /tmp/a.png\nend',
    '[Image #1]: /tmp/a.png and more text after',
    '```\n[Image #1]: /tmp/a.png\n```',
    '- [Image #1]: /tmp/a.png',
    'plain prose with a colon: like this'
  ])('renders text the pipeline already showed identically', (typed) => {
    expect(renderedText(escapeNativeChatUserMarkdown(typed))).toBe(renderedText(typed))
  })

  it.each(['keep [Image #1] literal', '```\n[Image #1]: /tmp/a.png\n```'])(
    'leaves lines that cannot open a definition byte-identical',
    (typed) => {
      expect(escapeNativeChatUserMarkdown(typed)).toBe(typed)
    }
  )

  it('escapes only the line-leading bracket, once per line', () => {
    expect(escapeNativeChatUserMarkdown('[a]: x\n[b]: y')).toBe('\\[a]: x\n\\[b]: y')
    expect(escapeNativeChatUserMarkdown('   [a]: x')).toBe('   \\[a]: x')
  })
})
