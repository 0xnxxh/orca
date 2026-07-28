import { describe, expect, it, vi } from 'vitest'
import { openHostedIosHybridRoute } from '../../scripts/hosted-ios-hybrid-route-handoff.mjs'

describe('hosted iOS hybrid route handoff', () => {
  it('uses native navigation after leaving Agent History', async () => {
    const emulator = { deviceUdid: 'simulator' }
    const waitForControl = vi
      .fn()
      .mockResolvedValueOnce({ label: 'Back' })
      .mockResolvedValueOnce({ label: 'Back to worktrees' })
      .mockResolvedValueOnce({ label: 'Back to hosts' })
      .mockResolvedValueOnce({ label: 'Open settings' })
    const tapControl = vi.fn().mockResolvedValue({ x: 0.5, y: 0.5 })
    const waitForLabelToDisappear = vi.fn().mockResolvedValue(undefined)

    await openHostedIosHybridRoute(
      emulator,
      10_000,
      waitForControl,
      tapControl,
      waitForLabelToDisappear
    )

    expect(tapControl.mock.calls.map((call) => call[1])).toEqual([
      'Back',
      'Back to worktrees',
      'Back to hosts',
      'Open settings',
      'Open hybrid workspace UI'
    ])
  })

  it('can finish onboarding before opening the hybrid route', async () => {
    const emulator = { deviceUdid: 'simulator' }
    const waitForControl = vi
      .fn()
      .mockResolvedValueOnce({ label: 'Open sessions in the terminal' })
      .mockResolvedValueOnce({ label: 'Skip notifications for now' })
      .mockResolvedValueOnce({ label: 'Back to worktrees' })
      .mockResolvedValueOnce({ label: 'Back to hosts' })
      .mockResolvedValueOnce({ label: 'Open settings' })
    const tapControl = vi.fn().mockResolvedValue({ x: 0.5, y: 0.5 })
    const waitForLabelToDisappear = vi.fn().mockResolvedValue(undefined)

    await openHostedIosHybridRoute(
      emulator,
      10_000,
      waitForControl,
      tapControl,
      waitForLabelToDisappear
    )

    expect(tapControl.mock.calls.map((call) => call[1])).toEqual([
      'Open sessions in the terminal',
      'Skip notifications for now',
      'Back to worktrees',
      'Back to hosts',
      'Open settings',
      'Open hybrid workspace UI'
    ])
  })
})
