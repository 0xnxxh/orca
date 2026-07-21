import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
// Return the English fallback so the assertion is stable without initializing i18n.
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { notifyEditorSaveFailure } from './editor-save-failure-notice'

describe('notifyEditorSaveFailure', () => {
  beforeEach(() => {
    toastError.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('surfaces a failed save as a toast instead of swallowing it (STA-2027)', () => {
    // Why: the regression was silent data loss — a save rejection must reach the user, not vanish.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    notifyEditorSaveFailure(new Error('disk full'))

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Failed to save the file. Please try again.')
  })

  it('logs the underlying error for diagnosis', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = new Error('EPERM')

    notifyEditorSaveFailure(cause)

    expect(consoleError).toHaveBeenCalledWith('[editor] file save failed', cause)
  })
})
