import { describe, expect, it, vi } from 'vitest'
import { dismissOverlays, ensureTerminal } from './app-driver.mjs'

function hiddenButton() {
  return {
    first: () => hiddenButton(),
    isVisible: vi.fn().mockResolvedValue(false),
    click: vi.fn()
  }
}

describe('dismissOverlays', () => {
  it('dismisses a dialog without clicking the desktop window Close button', async () => {
    const dialogClose = {
      first: vi.fn(),
      isVisible: vi.fn().mockResolvedValue(true),
      click: vi.fn().mockResolvedValue(undefined)
    }
    dialogClose.first.mockReturnValue(dialogClose)
    const windowClose = {
      first: vi.fn(),
      isVisible: vi.fn().mockResolvedValue(true),
      click: vi.fn().mockRejectedValue(new Error('window closed'))
    }
    windowClose.first.mockReturnValue(windowClose)

    const page = {
      locator: vi.fn().mockReturnValue(dialogClose),
      getByRole: vi.fn((_role, { name }) => (name === 'Close' ? windowClose : hiddenButton())),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      waitForTimeout: vi.fn().mockResolvedValue(undefined)
    }

    await dismissOverlays(page, 1)

    expect(dialogClose.click).toHaveBeenCalledOnce()
    expect(windowClose.click).not.toHaveBeenCalled()
    expect(page.locator).toHaveBeenCalledWith(
      '[data-slot="dialog-content"]:visible [data-slot="dialog-close"]'
    )
  })

  it('keeps overlay retries within the caller timeout budget', async () => {
    vi.useFakeTimers()
    try {
      const newWorkspace = {
        first: vi.fn(),
        click: vi.fn(async ({ timeout }) => {
          await vi.advanceTimersByTimeAsync(timeout)
          throw new Error('button remained blocked')
        })
      }
      newWorkspace.first.mockReturnValue(newWorkspace)
      const page = {
        locator: vi.fn().mockImplementation(() => hiddenButton()),
        getByRole: vi.fn((_role, { name }) =>
          name === 'New workspace' ? newWorkspace : hiddenButton()
        ),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        isClosed: vi.fn().mockReturnValue(false)
      }

      await expect(ensureTerminal(page, { timeoutMs: 12_000 })).rejects.toThrow(
        'button remained blocked'
      )

      expect(newWorkspace.click.mock.calls.map(([options]) => options.timeout)).toEqual([
        5_000, 5_000, 2_000, 1
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})
