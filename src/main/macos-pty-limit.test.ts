import { describe, expect, it, vi } from 'vitest'
import { MacosPtyLimitService } from './macos-pty-limit'

function createLogger() {
  return { warn: vi.fn() }
}

describe('MacosPtyLimitService', () => {
  it('reports unsupported without spawning commands off macOS', async () => {
    const runCommand = vi.fn()
    const service = new MacosPtyLimitService({ platform: 'linux', runCommand })

    await expect(service.getStatus()).resolves.toEqual({ state: 'unsupported' })
    await expect(service.increaseToMaximum()).resolves.toEqual({ outcome: 'unsupported' })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('reads the live limit from the fixed sysctl path', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: '511\n', stderr: '' })
    const service = new MacosPtyLimitService({ platform: 'darwin', runCommand })

    await expect(service.getStatus()).resolves.toEqual({
      state: 'available',
      currentLimit: 511,
      defaultLimit: 511,
      maximumLimit: 999
    })
    expect(runCommand).toHaveBeenCalledWith('/usr/sbin/sysctl', ['-n', 'kern.tty.ptmx_max'])
  })

  it('uses one fixed administrator command and verifies the result', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '511\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '999\n', stderr: '' })
    const service = new MacosPtyLimitService({ platform: 'darwin', runCommand })

    await expect(service.increaseToMaximum()).resolves.toMatchObject({
      outcome: 'increased',
      status: { currentLimit: 999 }
    })
    expect(runCommand).toHaveBeenNthCalledWith(2, '/usr/bin/osascript', [
      '-e',
      'do shell script "/usr/sbin/sysctl -w kern.tty.ptmx_max=999" with administrator privileges'
    ])
    expect(runCommand).toHaveBeenNthCalledWith(3, '/usr/sbin/sysctl', ['-n', 'kern.tty.ptmx_max'])
  })

  it('does not request authentication when the limit is already at maximum', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: '999\n', stderr: '' })
    const service = new MacosPtyLimitService({ platform: 'darwin', runCommand })

    await expect(service.increaseToMaximum()).resolves.toMatchObject({
      outcome: 'already-maximum'
    })
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('returns cancellation only for the macOS administrator cancellation code', async () => {
    const cancellation = Object.assign(new Error('osascript failed'), {
      stderr: 'execution error: User canceled. (-128)'
    })
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '511\n', stderr: '' })
      .mockRejectedValueOnce(cancellation)
    const service = new MacosPtyLimitService({ platform: 'darwin', runCommand })

    await expect(service.increaseToMaximum()).resolves.toEqual({ outcome: 'cancelled' })
  })

  it('coalesces concurrent increase requests into one administrator prompt', async () => {
    let releasePrompt: (() => void) | undefined
    const prompt = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    const runCommand = vi.fn(async (file: string) => {
      if (file === '/usr/bin/osascript') {
        await prompt
        return { stdout: '', stderr: '' }
      }
      const sysctlReads = runCommand.mock.calls.filter(
        ([path]) => path === '/usr/sbin/sysctl'
      ).length
      return { stdout: sysctlReads === 1 ? '511\n' : '999\n', stderr: '' }
    })
    const service = new MacosPtyLimitService({ platform: 'darwin', runCommand })

    const first = service.increaseToMaximum()
    const second = service.increaseToMaximum()
    expect(first).toBe(second)
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2))
    releasePrompt?.()

    await expect(first).resolves.toMatchObject({ outcome: 'increased' })
    expect(runCommand.mock.calls.filter(([file]) => file === '/usr/bin/osascript')).toHaveLength(1)
  })

  it('fails closed when the post-change value cannot be verified', async () => {
    const logger = createLogger()
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '511\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '700\n', stderr: '' })
    const service = new MacosPtyLimitService({ platform: 'darwin', runCommand, logger })

    await expect(service.increaseToMaximum()).resolves.toEqual({ outcome: 'failed' })
    expect(logger.warn).toHaveBeenCalledWith(
      '[macos-pty-limit] system PTY limit verification failed',
      expect.anything()
    )
  })
})
