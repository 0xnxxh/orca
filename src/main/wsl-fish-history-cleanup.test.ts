import { describe, expect, it, vi } from 'vitest'
import { deleteWslFishHistoryFile } from './wsl-fish-history-cleanup'

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

  it('serializes cleanup subprocesses across a startup tombstone batch', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<{ stdout: string; stderr: string }>((resolve) => {
      releaseFirst = () => resolve({ stdout: '', stderr: '' })
    })
    const run = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({ stdout: '', stderr: '' })

    const cleanupA = deleteWslFishHistoryFile('Ubuntu', 'orca_aaaaaaaaaaaaaaaa', run)
    const cleanupB = deleteWslFishHistoryFile('Debian', 'orca_bbbbbbbbbbbbbbbb', run)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    releaseFirst?.()
    await Promise.all([cleanupA, cleanupB])

    expect(run).toHaveBeenCalledTimes(2)
  })
})
