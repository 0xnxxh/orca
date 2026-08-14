// @vitest-environment happy-dom
// Why: a failed diff load renders the error text as the modified body. If that pane stays editable
// the save path writes it over the real file, because attemptEditorFileSave falls back to the body
// shown when no draft exists.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { DiffContent } from './editor-panel-content-types'

const captured = vi.hoisted(() => ({
  diffProps: [] as { editable?: boolean; onSave?: unknown; onContentChange?: unknown }[]
}))

vi.mock('@/lib/lazy-with-retry', () => ({
  lazyWithRetry: (factory: () => Promise<unknown>) => {
    if (factory.toString().includes('/DiffViewer.tsx')) {
      return function MockDiffViewer(props: {
        editable?: boolean
        onSave?: unknown
        onContentChange?: unknown
      }) {
        captured.diffProps.push(props)
        return null
      }
    }
    return () => null
  }
}))

vi.mock('@/store', () => {
  const state = {
    worktreesByRepo: {},
    openFile: vi.fn(),
    openMarkdownPreview: vi.fn(),
    openConflictReviewFile: vi.fn(),
    openConflictReview: vi.fn(),
    closeFile: vi.fn(),
    setRightSidebarTab: vi.fn(),
    setPendingEditorReveal: vi.fn(),
    reloadOpenCheckRunDetailsTab: vi.fn()
  }
  return {
    useAppStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) => selector(state),
      { getState: () => ({ ...state, folderWorkspaces: [], projectGroups: [], repos: [] }) }
    )
  }
})

import { EditorContent } from './EditorContent'

const ACTIVE_FILE: OpenFile = {
  id: '/repo/notes.ts',
  filePath: '/repo/notes.ts',
  relativePath: 'notes.ts',
  worktreeId: 'repo::/repo',
  language: 'typescript',
  isDirty: false,
  mode: 'diff',
  diffSource: 'unstaged'
}

function renderDiff(diff: DiffContent): void {
  render(
    <EditorContent
      activeFile={ACTIVE_FILE}
      viewStateScopeId={ACTIVE_FILE.id}
      fileContents={{}}
      diffContents={{ [ACTIVE_FILE.id]: diff }}
      editBuffers={{}}
      openFiles={[ACTIVE_FILE]}
      worktreeEntries={[]}
      resolvedLanguage="typescript"
      isMarkdown={false}
      isMermaid={false}
      isCsv={false}
      isNotebook={false}
      mdViewMode="rich"
      isChangesMode={false}
      sideBySide={false}
      pendingEditorReveal={null}
      handleContentChange={vi.fn()}
      handleContentChangeForFile={vi.fn()}
      handleDirtyStateHint={vi.fn()}
      handleSave={vi.fn()}
      handleSaveForFile={vi.fn()}
      reloadContent={vi.fn()}
    />
  )
}

function textDiff(modifiedContent: string, loadError?: boolean): DiffContent {
  return {
    kind: 'text',
    originalContent: '',
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false,
    ...(loadError === undefined ? {} : { loadError })
  }
}

afterEach(() => {
  cleanup()
  captured.diffProps.length = 0
})

describe('EditorContent diff load failures', () => {
  it('keeps a failed diff load read-only so its message cannot be saved over the file', () => {
    renderDiff(textDiff('Error loading diff: RuntimeRpcCallError: too large', true))

    const props = captured.diffProps.at(-1)
    expect(props?.editable).toBe(false)
    expect(props?.onSave).toBeUndefined()
    // Why: no draft can be minted either, or the next save would write the typed-over message.
    expect(props?.onContentChange).toBeUndefined()
  })

  it('leaves a normally loaded unstaged diff editable', () => {
    renderDiff(textDiff('export const a = 1\n'))

    const props = captured.diffProps.at(-1)
    expect(props?.editable).toBe(true)
    expect(props?.onSave).toBeTypeOf('function')
  })
})
