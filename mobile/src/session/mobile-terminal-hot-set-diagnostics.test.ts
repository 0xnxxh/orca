import { expect, it, vi } from 'vitest'
import {
  recordMobileTerminalColdRevealBoundary,
  recordMobileTerminalHotSetEviction,
  recordMobileTerminalHotSetFailOpen
} from './mobile-terminal-hot-set-diagnostics'

it('emits bounded mobile terminal hot-set diagnostics', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})

  recordMobileTerminalColdRevealBoundary('terminal-secret-12345678', 3, 'render-ready')
  recordMobileTerminalHotSetEviction('terminal-secret-12345678')
  recordMobileTerminalHotSetFailOpen('invalid-scrollback')
  recordMobileTerminalHotSetFailOpen(null)

  expect(log).toHaveBeenNthCalledWith(1, '[terminal-diagnostic]', 'cold-reveal-boundary', {
    handle: '12345678',
    revision: 3,
    boundary: 'render-ready',
    atMs: expect.any(Number)
  })
  expect(log).toHaveBeenNthCalledWith(2, '[terminal-diagnostic]', 'hot-set-evicted', {
    handle: '12345678'
  })
  expect(log).toHaveBeenNthCalledWith(3, '[terminal-diagnostic]', 'hot-set-failed-open', {
    reason: 'invalid-scrollback'
  })
  expect(log).toHaveBeenCalledTimes(3)
  log.mockRestore()
})
