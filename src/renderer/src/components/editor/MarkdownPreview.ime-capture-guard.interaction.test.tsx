// @vitest-environment happy-dom
//
// MarkdownPreview installs a window-level keydown listener in the capture phase, which
// runs before any composing element sees the key. This renders the real component and
// fires real events at that listener to prove the IME guard sits above the dispatch, per
// the IME Composition rules in AGENTS.md. Escape is the case that matters: it is how the
// user dismisses a candidate window, and closing search steals focus out from under a
// live composition.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeState = {
  openFile: vi.fn(),
  activateMarkdownLink: vi.fn(),
  openMarkdownPreview: vi.fn(),
  setMarkdownViewMode: vi.fn(),
  markdownFrontmatterVisible: {},
  setPendingEditorReveal: vi.fn(),
  addDiffComment: vi.fn(),
  deleteDiffComment: vi.fn(),
  updateDiffComment: vi.fn(),
  clearDeliveredDiffComments: vi.fn(),
  keybindings: {},
  worktreesByRepo: {},
  repos: [],
  folderWorkspaces: [],
  projectGroups: [],
  openFiles: [],
  activeFileIdByWorktree: {},
  settings: { openLinksInApp: true },
  editorFontZoomLevel: 0
}

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
  return { useAppStore }
})
vi.mock('@/store/slices/worktree-helpers', () => ({ findWorktreeById: () => null }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  settingsForRuntimeOwner: (settings: unknown) => settings
}))
vi.mock('@/runtime/runtime-file-client', () => ({
  statRuntimePath: vi.fn(async () => ({ isDirectory: false }))
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => null }))
vi.mock('@/lib/connection-owner-resolution', () => ({
  createConnectionIdForFileSelector: () => () => null
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./useLocalImageSrc', () => ({ useLocalImageSrc: (src?: string) => src }))
vi.mock('./MermaidBlock', () => ({ default: () => null }))
vi.mock('./CodeBlockCopyButton', () => ({
  default: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('../diff-comments/DiffCommentCard', () => ({ DiffCommentCard: () => null }))
vi.mock('./NotesSendMenu', () => ({ NotesSendMenu: () => null }))
vi.mock('./MarkdownTableOfContentsPanel', () => ({ MarkdownTableOfContentsPanel: () => null }))

import MarkdownPreview from './MarkdownPreview'

const DOC = '# Intro\n\nSome searchable body text.'

describe('MarkdownPreview window-capture listener yields to a composition', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true
    })
    ;(window as unknown as { api: unknown }).api = {
      shell: { openUrl: vi.fn(), openFileUri: vi.fn(), pathExists: vi.fn(async () => true) },
      ui: { writeClipboardText: vi.fn(async () => true) }
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <MarkdownPreview
          content={DOC}
          filePath="/repo/docs/README.md"
          sourceWorktreeId="wt-1"
          scrollCacheKey="ime-capture-guard"
        />
      )
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const previewRoot = (): HTMLElement => {
    const element = container.querySelector('.markdown-preview')
    if (!(element instanceof HTMLElement)) {
      throw new Error('preview root did not render')
    }
    return element
  }
  const searchIsOpen = (): boolean => container.querySelector('.markdown-preview-search') !== null

  function dispatch(init: KeyboardEventInit & { keyCode?: number }): void {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    if (init.keyCode !== undefined) {
      Object.defineProperty(event, 'keyCode', { value: init.keyCode })
    }
    act(() => {
      previewRoot().dispatchEvent(event)
    })
  }

  const openSearch = (): void => dispatch({ key: 'f', code: 'KeyF', metaKey: true })

  it('leaves search open when the IME owns the Escape', () => {
    openSearch()
    expect(searchIsOpen()).toBe(true)

    dispatch({ key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true })

    expect(searchIsOpen()).toBe(true)
  })

  it('still closes search on an unmarked Escape', () => {
    openSearch()
    expect(searchIsOpen()).toBe(true)

    dispatch({ key: 'Escape', code: 'Escape', keyCode: 27 })

    expect(searchIsOpen()).toBe(false)
  })

  it('does not open search on a find chord the IME owns', () => {
    dispatch({ key: 'f', code: 'KeyF', metaKey: true, isComposing: true })

    expect(searchIsOpen()).toBe(false)
  })
})
