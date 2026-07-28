import { describe, expect, it, vi } from 'vitest'
import {
  rotateHostedIosEmulator,
  tapHostedIosAccessibilityControl,
  tapHostedIosAccessibilityControlAtOccurrence,
  tapHostedIosAccessibilityControlByLabelPrefix,
  waitForHostedIosAccessibilityControl,
  waitForHostedIosAccessibilityControlByLabelPrefix,
  waitForHostedIosAccessibilityLabelToDisappear
} from '../../scripts/hosted-ios-emulator-accessibility.mjs'

const emulator = {
  deviceUdid: 'simulator-a',
  orcaCli: '/repo/config/scripts/orca-dev.mjs',
  userDataDir: '/tmp/orca-mobile/userData',
  worktree: '/repo'
}

describe('hosted iOS emulator accessibility controls', () => {
  it('rotates through the isolated Orca emulator controller', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stderr: '', stdout: '{}' })

    await rotateHostedIosEmulator(emulator, 'landscape_left', runCommand)

    expect(runCommand).toHaveBeenCalledWith(emulator, ['rotate', 'landscape_left'])
  })

  it('finds a nested enabled control and taps its normalized center', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          result: [
            {
              label: 'Orca',
              children: [
                {
                  label: 'Resume agent session',
                  enabled: true,
                  frame: { x: 0.6, y: 0.7, width: 0.2, height: 0.1 }
                }
              ]
            }
          ]
        })
      })
      .mockResolvedValueOnce({ stderr: '', stdout: JSON.stringify({ ok: true }) })

    await expect(
      tapHostedIosAccessibilityControl(emulator, 'Resume agent session', 1_000, runCommand)
    ).resolves.toEqual({ x: 0.7, y: 0.75 })
    expect(runCommand).toHaveBeenLastCalledWith(emulator, ['tap', '0.7', '0.75'])
  })

  it('selects a specific visible occurrence without changing the label contract', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({
          ok: true,
          result: [
            {
              label: 'mobile-rearch',
              enabled: true,
              frame: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }
            },
            {
              label: 'mobile-rearch',
              enabled: true,
              frame: { x: 0.1, y: 0.3, width: 0.3, height: 0.1 }
            }
          ]
        })
      })
      .mockResolvedValueOnce({ stderr: '', stdout: JSON.stringify({ ok: true }) })

    await expect(
      tapHostedIosAccessibilityControlAtOccurrence(emulator, 'mobile-rearch', 1, 1_000, runCommand)
    ).resolves.toEqual({ x: 0.25, y: 0.35 })
    expect(runCommand).toHaveBeenLastCalledWith(emulator, ['tap', '0.25', '0.35'])
  })

  it('targets a composite native row by its leading visible label', async () => {
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
      tapHostedIosAccessibilityControlByLabelPrefix(emulator, 'mobile-rearch', 1_000, runCommand)
    ).resolves.toEqual({ x: 0.5, y: 0.25 })
    expect(runCommand).toHaveBeenLastCalledWith(emulator, ['tap', '0.5', '0.25'])
  })

  it('reads a composite native row point without tapping it', async () => {
    const runCommand = vi.fn().mockResolvedValueOnce({
      stderr: '',
      stdout: JSON.stringify({
        ok: true,
        result: [
          {
            label: 'Hybrid Agent History Fixture, 2h, Preview',
            enabled: true,
            frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 }
          }
        ]
      })
    })

    await expect(
      waitForHostedIosAccessibilityControlByLabelPrefix(
        emulator,
        'Hybrid Agent History Fixture',
        1_000,
        runCommand
      )
    ).resolves.toEqual({ x: 0.5, y: 0.25 })
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid accessibility response', async () => {
    await expect(
      waitForHostedIosAccessibilityControl(emulator, 'Resume agent session', 1_000, async () => ({
        stderr: '',
        stdout: JSON.stringify({ ok: true, result: null })
      }))
    ).rejects.toThrow('invalid accessibility response')
  })

  it('restarts a wedged emulator controller before retrying accessibility', async () => {
    const runCommand = vi.fn(async (_args, command) => {
      if (command[0] === 'ax' && runCommand.mock.calls.length === 1) {
        throw new Error('emulator_helper_failed: request timed out')
      }
      if (command[0] === 'ax') {
        return {
          stderr: '',
          stdout: JSON.stringify({
            ok: true,
            result: [
              {
                label: 'Resume agent session',
                enabled: true,
                frame: { x: 0.6, y: 0.7, width: 0.2, height: 0.1 }
              }
            ]
          })
        }
      }
      return { stderr: '', stdout: JSON.stringify({ ok: true }) }
    })

    await expect(
      waitForHostedIosAccessibilityControl(emulator, 'Resume agent session', 1_000, runCommand)
    ).resolves.toEqual({ x: 0.7, y: 0.75 })
    expect(runCommand.mock.calls.map(([, command]) => command[0])).toEqual([
      'ax',
      'kill',
      'attach',
      'ax'
    ])
  })

  it('waits for a reconnect label to leave the native accessibility tree', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({ ok: true, result: [{ label: 'Reconnecting' }] })
      })
      .mockResolvedValueOnce({
        stderr: '',
        stdout: JSON.stringify({ ok: true, result: [{ label: '1 tab' }] })
      })

    await expect(
      waitForHostedIosAccessibilityLabelToDisappear(emulator, 'Reconnecting', 1_000, runCommand)
    ).resolves.toBeUndefined()
  })
})
