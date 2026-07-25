import { expect, it, vi } from 'vitest'
import {
  getTerminalTabProviderTeardown,
  trackTerminalTabProviderTeardown
} from './terminal-tab-provider-teardown'

it('bounds failed retry authority and re-runs the newest teardown', async () => {
  const retries = Array.from({ length: 129 }, () => vi.fn().mockResolvedValue(undefined))
  for (const [index, retry] of retries.entries()) {
    trackTerminalTabProviderTeardown(
      [`failed-tab-${index}`],
      Promise.reject(new Error('provider unavailable')),
      retry
    )
  }
  await Promise.resolve()

  expect(getTerminalTabProviderTeardown('failed-tab-0')).toBeUndefined()
  await expect(getTerminalTabProviderTeardown('failed-tab-128')).resolves.toBeUndefined()
  expect(retries[128]).toHaveBeenCalledOnce()
})
