import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import type { EditorView } from '@tiptap/pm/view'
import { handleRichMarkdownEditorClick } from './rich-markdown-editor-click-routing'
import type { HttpLinkSourceOwner } from '@/lib/http-link-routing'

const openHttpLinkMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/http-link-routing', () => ({
  openHttpLink: openHttpLinkMock
}))

beforeEach(() => {
  openHttpLinkMock.mockReset()
})

// Why: the rich editor and the markdown preview render the same file, so a link
// clicked in either must reach the same destination.
function clickExternalLinkWithShift(sourceOwner: HttpLinkSourceOwner): boolean {
  const href = 'https://example.com/docs'
  const view = {
    state: {
      doc: {
        nodeAt: () => null,
        resolve: () => ({
          marks: () => [{ type: { name: 'link' }, attrs: { href } }]
        })
      }
    }
  } as unknown as EditorView

  return handleRichMarkdownEditorClick({
    activateMarkdownLink: vi.fn(),
    editorRef: { current: {} } as unknown as MutableRefObject<unknown>,
    event: { metaKey: true, ctrlKey: false, shiftKey: true } as MouseEvent,
    filePath: '/repo/docs/README.md',
    isMac: true,
    htmlSuperscriptLinkContext: {
      getSnapshot: () => ({ sourceOwner })
    },
    markdownCommentsRef: { current: [] },
    markdownSourceLineOffsetRef: { current: 0 },
    onOpenDocLinkRef: { current: undefined },
    pos: 1,
    rootRef: { current: null },
    scrollRichMarkdownReviewNoteCardIntoView: vi.fn(),
    settings: {} as never,
    view,
    worktreeId: 'wt-1',
    worktreeRoot: '/repo'
  } as never)
}

describe('rich markdown editor Shift+modifier click on external links', () => {
  it('defers the destination to openHttpLink instead of forcing the system browser', () => {
    expect(clickExternalLinkWithShift({ kind: 'local' })).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith('https://example.com/docs', {
      worktreeId: 'wt-1',
      modifierHeld: true,
      sourceOwner: { kind: 'local' }
    })
  })

  // Why: openHttpLink refuses to route a non-local source into Orca, so the owner
  // has to survive the hop or an SSH file's links could land in the wrong browser.
  it('preserves a non-local source owner so remote files stay out of Orca', () => {
    const sourceOwner = { kind: 'ssh', connectionId: 'conn-1' } as HttpLinkSourceOwner

    expect(clickExternalLinkWithShift(sourceOwner)).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({ modifierHeld: true, sourceOwner })
    )
  })
})
