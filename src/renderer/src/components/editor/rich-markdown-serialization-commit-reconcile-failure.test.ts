import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'

const { reconcileSerializedMarkdown } = vi.hoisted(() => ({
  reconcileSerializedMarkdown: vi.fn()
}))
vi.mock('./rich-markdown-source-reconcile', () => ({ reconcileSerializedMarkdown }))

import { commitRichMarkdownSerialization } from './rich-markdown-serialization-commit'

function editorReturning(markdown: string): Editor {
  return { getMarkdown: () => markdown } as unknown as Editor
}
function refs(source: string, base: string, last: string) {
  return {
    originalSourceRef: { current: source },
    baseCanonicalRef: { current: base },
    lastCommittedMarkdownRef: { current: last }
  }
}

describe('commitRichMarkdownSerialization reconcile-failure fallback (STA-2027/#9158)', () => {
  it('degrades to canonical output instead of throwing when reconcile fails', () => {
    // Regression: the Cmd+S path (rich-markdown-save-shortcut) has no try/catch, and the debounced
    // onUpdate/flush paths swallowed the throw silently — leaving the draft stale and stalling
    // auto-save. commit must never propagate a reconcile throw on a live editor.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    reconcileSerializedMarkdown.mockImplementation(() => {
      throw new Error('Failed to determine byte offset')
    })
    const r = refs('# old\n\n_강조_', '# old\n\n*강조*', '# old\n\n_강조_')

    let threw = false
    let result: ReturnType<typeof commitRichMarkdownSerialization> | undefined
    try {
      result = commitRichMarkdownSerialization(editorReturning('# 제목\n\n_강조_'), r, (md) => md)
    } catch {
      threw = true
    }

    // No throw; degrades to the canonical getMarkdown output so content is never lost.
    expect(threw).toBe(false)
    expect(result).toEqual({ markdown: '# 제목\n\n_강조_', didSerialize: true })
    // All three refs advance consistently to the canonical output for the next incremental commit.
    expect(r.originalSourceRef.current).toBe('# 제목\n\n_강조_')
    expect(r.baseCanonicalRef.current).toBe('# 제목\n\n_강조_')
    expect(r.lastCommittedMarkdownRef.current).toBe('# 제목\n\n_강조_')
    // The failure is observable, not silent.
    expect(consoleError).toHaveBeenCalled()
  })

  it('returns the torn-down fallback (no reconcile) when the editor is gone', () => {
    // A null editor short-circuits before reconcile, so the last committed bytes are reused as-is.
    const result = commitRichMarkdownSerialization(
      null,
      refs('src', 'base', 'last-committed'),
      (md) => md
    )

    expect(result).toEqual({ markdown: 'last-committed', didSerialize: false })
  })
})
