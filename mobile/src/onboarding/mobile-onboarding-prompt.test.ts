import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldPresentNotificationOptIn } from '../notifications/notification-opt-in-gate'
import { shouldPresentSessionViewOptIn } from '../session/session-view-opt-in-gate'
import {
  mobileOnboardingDestination,
  selectMobileOnboardingPrompt
} from './mobile-onboarding-prompt'

vi.mock('../notifications/notification-opt-in-gate', () => ({
  shouldPresentNotificationOptIn: vi.fn()
}))
vi.mock('../session/session-view-opt-in-gate', () => ({
  shouldPresentSessionViewOptIn: vi.fn()
}))

describe('mobile onboarding prompt', () => {
  beforeEach(() => {
    vi.mocked(shouldPresentNotificationOptIn).mockReset().mockResolvedValue(false)
    vi.mocked(shouldPresentSessionViewOptIn).mockReset().mockResolvedValue(false)
  })

  it('shows notifications first without probing later prompts', async () => {
    vi.mocked(shouldPresentNotificationOptIn).mockResolvedValue(true)

    await expect(selectMobileOnboardingPrompt()).resolves.toBe('notifications')
    expect(shouldPresentNotificationOptIn).toHaveBeenCalledOnce()
    expect(shouldPresentSessionViewOptIn).not.toHaveBeenCalled()
  })

  it('falls through to the session-view decision', async () => {
    vi.mocked(shouldPresentSessionViewOptIn).mockResolvedValue(true)

    await expect(selectMobileOnboardingPrompt()).resolves.toBe('session-view')
    expect(shouldPresentNotificationOptIn).toHaveBeenCalledOnce()
    expect(shouldPresentSessionViewOptIn).toHaveBeenCalledOnce()
  })

  it('continues when both decisions have already been made', async () => {
    await expect(selectMobileOnboardingPrompt()).resolves.toBeNull()
    expect(shouldPresentNotificationOptIn).toHaveBeenCalledOnce()
    expect(shouldPresentSessionViewOptIn).toHaveBeenCalledOnce()
  })

  it.each([
    ['notifications', undefined, '/notification-opt-in'],
    ['session-view', undefined, '/session-view-opt-in'],
    [null, undefined, '/'],
    [
      'notifications',
      'paired-host',
      { pathname: '/notification-opt-in', params: { hostId: 'paired-host' } }
    ],
    [
      'session-view',
      'paired-host',
      { pathname: '/session-view-opt-in', params: { hostId: 'paired-host' } }
    ],
    [null, 'paired-host', '/h/paired-host']
  ] as const)('maps %s with host %s to the correct destination', (prompt, hostId, destination) => {
    expect(mobileOnboardingDestination(prompt, hostId)).toEqual(destination)
  })
})
