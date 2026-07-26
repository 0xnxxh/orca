import { expect, it, vi } from 'vitest'
import {
  getTerminalTabProviderTeardown,
  trackTerminalTabProviderTeardown
} from './terminal-tab-provider-teardown'

it('fails closed after retry authority eviction and re-runs the newest teardown', async () => {
  const retries = Array.from({ length: 129 }, () => vi.fn().mockResolvedValue(undefined))
  for (const [index, retry] of retries.entries()) {
    trackTerminalTabProviderTeardown(
      [`failed-tab-${index}`],
      Promise.reject(new Error('provider unavailable')),
      retry
    )
  }
  await Promise.resolve()

  await expect(getTerminalTabProviderTeardown('failed-tab-0')).rejects.toThrow(
    'terminal_tab_close_failed'
  )
  expect(getTerminalTabProviderTeardown('never-tracked-tab')).toBeUndefined()
  await expect(getTerminalTabProviderTeardown('failed-tab-128')).resolves.toBeUndefined()
  expect(retries[128]).toHaveBeenCalledOnce()
})
