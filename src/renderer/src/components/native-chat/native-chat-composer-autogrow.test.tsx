// @vitest-environment happy-dom

/** The composer grows with the draft up to 8 lines, then scrolls internally.
 *  Sizing is layout-driven (field-sizing + an lh-relative cap) rather than a JS
 *  measure pass, so these assert the class contract that produces it. happy-dom
 *  has no layout engine, so real pixel growth is covered by app validation. */

import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('./NativeChatComposerActions', () => ({
  NativeChatComposerActions: () => <div data-testid="composer-actions" />
}))

vi.mock('./NativeChatAutocompleteMenus', () => ({
  NativeChatMentionHint: () => null,
  NativeChatPickerMenu: () => null
}))

import { NativeChatComposerField } from './NativeChatComposerField'

afterEach(() => cleanup())

function renderField(draft: string): HTMLTextAreaElement {
  render(
    <NativeChatComposerField
      textareaRef={createRef<HTMLTextAreaElement>()}
      draft={draft}
      disabled={false}
      hasPty
      canSend
      autocomplete={{ mode: 'none' }}
      activeSuggestion={0}
      notice={null}
      imageAttachments={[]}
      sendButtonDisabled={false}
      isWorking={false}
      attachDisabled={false}
      dictationDisabled={false}
      isDictating={false}
      isDictationHoldMode={false}
      onDraftChange={vi.fn()}
      onTextareaSelect={vi.fn()}
      onKeyDown={vi.fn()}
      onCompositionEnd={vi.fn()}
      onPaste={vi.fn()}
      pickerListboxId="picker"
      onChoosePickerItem={vi.fn()}
      onRetrySkills={vi.fn()}
      onAcceptMention={vi.fn()}
      onRemoveImageAttachment={vi.fn()}
      onAttach={vi.fn()}
      onDictationToggle={vi.fn()}
      onDictationHoldStart={vi.fn()}
      onDictationHoldEnd={vi.fn()}
      onSend={vi.fn()}
      sessionOptionsSurface={null}
      sessionOptionsSnapshot={[]}
    />
  )
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

function composerField(draft: string, onDraftChange = vi.fn(), onCompositionEnd = vi.fn()) {
  return (
    <NativeChatComposerField
      textareaRef={createRef<HTMLTextAreaElement>()}
      draft={draft}
      disabled={false}
      hasPty
      canSend
      autocomplete={{ mode: 'none' }}
      activeSuggestion={0}
      notice={null}
      imageAttachments={[]}
      sendButtonDisabled={false}
      isWorking={false}
      attachDisabled={false}
      dictationDisabled={false}
      isDictating={false}
      isDictationHoldMode={false}
      onDraftChange={onDraftChange}
      onTextareaSelect={vi.fn()}
      onKeyDown={vi.fn()}
      onCompositionEnd={onCompositionEnd}
      onPaste={vi.fn()}
      pickerListboxId="picker"
      onChoosePickerItem={vi.fn()}
      onRetrySkills={vi.fn()}
      onAcceptMention={vi.fn()}
      onRemoveImageAttachment={vi.fn()}
      onAttach={vi.fn()}
      onDictationToggle={vi.fn()}
      onDictationHoldStart={vi.fn()}
      onDictationHoldEnd={vi.fn()}
      onSend={vi.fn()}
      sessionOptionsSurface={null}
      sessionOptionsSnapshot={[]}
    />
  )
}

describe('native chat composer autogrow', () => {
  it('sizes the textarea from its content instead of staying at rows={2}', () => {
    expect(renderField('').className).toContain('[field-sizing:content]')
  })

  it('caps growth at 8 lines plus the py-1 padding box', () => {
    // 8lh tracks the rendered line-height, so the cap follows the text tokens
    // instead of a hardcoded pixel value like the old max-h-28 (112px).
    const textarea = renderField('a\n'.repeat(20))
    expect(textarea.className).toContain('max-h-[calc(8lh+0.5rem)]')
    expect(textarea.className).not.toContain('max-h-28')
  })

  it('keeps the sleek scrollbar for the overflow past the cap', () => {
    expect(renderField('a\n'.repeat(20)).className).toContain('scrollbar-sleek')
  })

  it('keeps the touch-target minimum heights', () => {
    const textarea = renderField('')
    expect(textarea.className).toContain('min-h-12')
    expect(textarea.className).toContain('pointer-coarse:min-h-14')
  })

  it('does not pin an inline height that a resize could leave stale', () => {
    // A JS measure pass writes style.height and only re-measures on the next
    // value change, so a re-wrap from a window/pane resize would strand it.
    expect(renderField('a\n'.repeat(6)).style.height).toBe('')
  })
})

describe('native chat composer composition ownership', () => {
  it('keeps a streaming rerender from overwriting the active browser composition', () => {
    const onDraftChange = vi.fn()
    const onCompositionEnd = vi.fn()
    const view = render(composerField('', onDraftChange, onCompositionEnd))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.compositionStart(textarea)
    textarea.value = '한'

    view.rerender(composerField('stale streaming draft', onDraftChange, onCompositionEnd))

    expect(screen.getByRole('textbox')).toBe(textarea)
    expect(textarea.value).toBe('한')
    fireEvent.compositionEnd(textarea, { data: '한' })
    expect(onCompositionEnd).toHaveBeenCalledOnce()
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it('applies an external draft update while the composer is idle', () => {
    const view = render(composerField('before'))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    view.rerender(composerField('after'))

    expect(screen.getByRole('textbox')).toBe(textarea)
    expect(textarea.value).toBe('after')
  })
})
