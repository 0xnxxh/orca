// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiVaultSessionLimitNotice } from './AiVaultSessionLimitNotice'

afterEach(() => {
  cleanup()
})

describe('AiVaultSessionLimitNotice', () => {
  it('explains the performance reset and acknowledges on Got it', async () => {
    const onAcknowledge = vi.fn()
    render(<AiVaultSessionLimitNotice onAcknowledge={onAcknowledge} />)

    const notice = screen.getByRole('status')
    expect(notice.textContent).toContain('History depth is now 250')
    expect(notice.textContent).toContain('for performance')

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('reflows the panel instead of floating over it', () => {
    // Why: a floating card cannot clear this ~350px panel, so the notice must stay in
    // flow — no portal, no fixed/absolute positioning that would cover the controls.
    const { container } = render(<AiVaultSessionLimitNotice onAcknowledge={vi.fn()} />)

    const notice = screen.getByRole('status')
    expect(container.contains(notice)).toBe(true)
    expect(notice.className).not.toMatch(/\b(fixed|absolute)\b/)
  })
})
