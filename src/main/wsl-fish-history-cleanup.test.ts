import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteWslFishHistoryFile, flushWslFishHistoryCleanups } from './wsl-fish-history-cleanup'

afterEach(async () => {
  await flushWslFishHistoryCleanups()
})

describe('deleteWslFishHistoryFile', () => {
  it('uses direct argv and bounds a distro cleanup subprocess', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    await deleteWslFishHistoryFile('Ubuntu Test', 'orca_0123456789abcdef', run)

    expect(run).toHaveBeenCalledWith(
      'wsl.exe',
      [
        '--distribution',
        'Ubuntu Test',
        '--exec',
        'fish',
        '--command',
        expect.stringContaining('orca_0123456789abcdef_history')
      ],
      { timeout: 5_000, windowsHide: true }
    )
  })

  it('rejects an unsafe session before spawning', async () => {
    const run = vi.fn()

    await deleteWslFishHistoryFile('Ubuntu', '../../user-history', run)

    expect(run).not.toHaveBeenCalled()
  })

  it('runs cleanup subprocesses concurrently within the fixed budget', async () => {
    const releases: (() => void)[] = []
    const run = vi.fn(() => {
      return new Promise<{ stdout: string; stderr: string }>((resolve) => {
        releases.push(() => resolve({ stdout: '', stderr: '' }))
      })
    }) as unknown as Parameters<typeof deleteWslFishHistoryFile>[2]
    const cleanups = Array.from({ length: 5 }, (_, index) =>
      deleteWslFishHistoryFile('Ubuntu', `orca_${(index + 1).toString(16)}`, run)
    )
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(4))
    expect(releases).toHaveLength(4)
    releases[0]()
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(5))
    expect(releases).toHaveLength(5)
    releases.slice(1).forEach((release) => release())
    await Promise.all(cleanups)
  })

  it('coalesces duplicate requests and bounds adversarial startup fanout', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const duplicateA = deleteWslFishHistoryFile('Ubuntu', 'orca_aaaaaaaaaaaaaaaa', run)
    const duplicateB = deleteWslFishHistoryFile('Ubuntu', 'orca_aaaaaaaaaaaaaaaa', run)
    expect(duplicateB).toBe(duplicateA)

    const requests = Array.from({ length: 1_000 }, (_, index) =>
      deleteWslFishHistoryFile('Ubuntu', `orca_${index.toString(16)}`, run)
    )
    await Promise.allSettled([duplicateA, ...requests])

    // Four live workers and 64 bounded queue slots; excess work remains durable on disk.
    expect(run).toHaveBeenCalledTimes(68)
  })

  it('permits a failed cleanup to be retried after the live attempt settles', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('wsl unavailable'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    await expect(deleteWslFishHistoryFile('Ubuntu', 'orca_aaaaaaaaaaaaaaaa', run)).rejects.toThrow(
      'wsl unavailable'
    )
    await expect(
      deleteWslFishHistoryFile('Ubuntu', 'orca_aaaaaaaaaaaaaaaa', run)
    ).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
