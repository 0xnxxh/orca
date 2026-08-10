import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_CHECK_DETAILS_TIMEOUT_MS,
  withGitHubCheckDetailsTimeout
} from './github-check-details-timeout'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

describe('withGitHubCheckDetailsTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes through a result and clears its deadline', async () => {
    await expect(withGitHubCheckDetailsTimeout(Promise.resolve('details'))).resolves.toBe('details')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a stalled local request after the remote RPC budget', async () => {
    const stalled = withGitHubCheckDetailsTimeout(new Promise(() => {}))
    const assertion = expect(stalled).rejects.toThrow('Timed out loading check details.')

    await vi.advanceTimersByTimeAsync(GITHUB_CHECK_DETAILS_TIMEOUT_MS)

    await assertion
  })
})
