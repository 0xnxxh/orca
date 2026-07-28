import { describe, expect, it, vi } from 'vitest'
import { longPressHostedIosAccessibilityControlByLabelPrefix } from '../../scripts/hosted-ios-emulator-long-press.mjs'

const emulator = {
  deviceUdid: 'simulator-a',
  orcaCli: '/repo/config/scripts/orca-dev.mjs',
  userDataDir: '/tmp/orca-mobile/userData',
  worktree: '/repo'
}

describe('hosted iOS emulator long press', () => {
  it('holds a composite workspace row beyond the React Native threshold', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          result: [
            {
              label: 'mobile-rearch, mobile-rearch, 1',
              enabled: true,
              frame: { x: 0, y: 0.2, width: 1, height: 0.1 }
            }
          ]
        })
      })
      .mockResolvedValueOnce({ stderr: '', stdout: JSON.stringify({ ok: true }) })

    await expect(
      longPressHostedIosAccessibilityControlByLabelPrefix(
        emulator,
        'mobile-rearch',
        1_000,
        runCommand
      )
    ).resolves.toEqual({ x: 0.5, y: 0.25 })

    const gesture = JSON.parse(runCommand.mock.calls[1]?.[1][1] as string)
    expect(runCommand.mock.calls[1]?.[1][0]).toBe('gesture')
    expect(gesture).toHaveLength(32)
    expect(gesture[0]).toEqual({ type: 'begin', x: 0.5, y: 0.25 })
    expect(gesture.at(-1)).toEqual({ type: 'end', x: 0.5, y: 0.25 })
  })
})
