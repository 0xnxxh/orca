// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnedSkillShareLinks } from './OwnedSkillShareLinks'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'api')
})

describe('OwnedSkillShareLinks', () => {
  it('copies and revokes owner-only shared links', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    const revokeShare = vi.fn().mockResolvedValue({ status: 'ok', value: undefined })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ui: { writeClipboardText },
        skills: {
          listOwnedShares: vi.fn().mockResolvedValue({
            status: 'ok',
            value: [
              {
                id: 'share_1',
                url: 'https://share.onorca.dev/skills/share/share_1',
                packageId: 'package_1',
                name: 'team-skills',
                description: 'Team bundle',
                createdAt: '2026-08-12T00:00:00.000Z'
              }
            ]
          }),
          revokeShare
        }
      }
    })
    const user = userEvent.setup()
    render(<OwnedSkillShareLinks />)

    await screen.findByText('team-skills')
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeClipboardText).toHaveBeenCalledWith('https://share.onorca.dev/skills/share/share_1')

    await user.click(screen.getByRole('button', { name: 'Unshare' }))
    expect(revokeShare).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm unshare' }))
    await waitFor(() => expect(revokeShare).toHaveBeenCalledWith('share_1'))
    expect(screen.queryByText('team-skills')).not.toBeInTheDocument()
  })
})
