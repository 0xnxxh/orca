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

// Why: the preview half of this same decision is pinned with an identical options
// shape in markdown-preview-links.test.ts — the two together keep the editor and
// preview of one file from routing a link two different ways.
function clickExternalLinkWithShift(sourceOwner: HttpLinkSourceOwner, isMac = true): boolean {
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
    event: { metaKey: isMac, ctrlKey: !isMac, shiftKey: true } as MouseEvent,
    filePath: '/repo/docs/README.md',
    isMac,
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

  // Why: AGENTS.md — Shift+Ctrl is the chord off macOS, and modKey reads a
  // different event field there.
  it('uses the Ctrl chord off macOS', () => {
    expect(clickExternalLinkWithShift({ kind: 'local' }, false)).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith('https://example.com/docs', {
      worktreeId: 'wt-1',
      modifierHeld: true,
      sourceOwner: { kind: 'local' }
    })
  })

  // Why: the owner has to survive the hop; openHttpLink is what then refuses to put
  // a non-local source in Orca (enforced in http-link-routing.test.ts, not here).
  it('forwards a non-local source owner untouched', () => {
    const sourceOwner = { kind: 'ssh', connectionId: 'conn-1' } as HttpLinkSourceOwner

    expect(clickExternalLinkWithShift(sourceOwner)).toBe(true)
    expect(openHttpLinkMock).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({ modifierHeld: true, sourceOwner })
    )
  })
})
