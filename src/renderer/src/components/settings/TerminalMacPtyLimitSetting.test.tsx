// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalMacPtyLimitSetting } from './TerminalMacPtyLimitSetting'

const { confirm, toastError, toastSuccess } = vi.hoisted(() => ({
  confirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => confirm
}))
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))
vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, defaultValue: string, values?: { value0?: unknown }) =>
    defaultValue.replace('{{value0}}', String(values?.value0 ?? '{{value0}}'))
}))

const defaultStatus = {
  state: 'available' as const,
  currentLimit: 511,
  defaultLimit: 511,
  maximumLimit: 999
}

describe('TerminalMacPtyLimitSetting', () => {
  let container: HTMLDivElement
  let root: Root
  let getStatus: ReturnType<typeof vi.fn>
  let increase: ReturnType<typeof vi.fn>

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    getStatus = vi.fn().mockResolvedValue(defaultStatus)
    increase = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { macosPtyLimit: { getStatus, increase } }
    })
    confirm.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.replaceChildren()
  })

  async function renderSetting(): Promise<void> {
    await act(async () => {
      root.render(<TerminalMacPtyLimitSetting />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function increaseButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Increase to 999')
    )
    if (!button) {
      throw new Error('increase button not found')
    }
    return button
  }

  it('shows the live limit and maximum action', async () => {
    await renderSetting()

    expect(container.textContent).toContain('Current: 511 · Resets after restart')
    expect(increaseButton().disabled).toBe(false)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the privileged action when confirmation is cancelled', async () => {
    confirm.mockResolvedValue(false)
    await renderSetting()

    await act(async () => {
      increaseButton().click()
      await Promise.resolve()
    })

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Increase limit' })
    )
    expect(increase).not.toHaveBeenCalled()
  })

  it('updates verified status after the administrator action succeeds', async () => {
    confirm.mockResolvedValue(true)
    increase.mockResolvedValue({
      outcome: 'increased',
      status: { ...defaultStatus, currentLimit: 999 }
    })
    await renderSetting()

    await act(async () => {
      increaseButton().click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(increase).toHaveBeenCalledWith()
    expect(container.textContent).toContain('999 · Maximum')
    expect(toastSuccess).toHaveBeenCalledWith('System PTY limit increased to 999 until restart.')
  })

  it('reports a failed administrator action without changing the live status', async () => {
    confirm.mockResolvedValue(true)
    increase.mockResolvedValue({ outcome: 'failed' })
    await renderSetting()

    await act(async () => {
      increaseButton().click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Current: 511 · Resets after restart')
    expect(toastError).toHaveBeenCalledWith('Couldn’t increase the system PTY limit.')
  })

  it('stays hidden when the current client cannot change the local Mac', async () => {
    getStatus.mockResolvedValue({ state: 'unsupported' })
    await renderSetting()

    expect(container.textContent).toBe('')
  })
})
