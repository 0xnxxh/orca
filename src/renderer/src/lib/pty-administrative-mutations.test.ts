import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  capturePtyAdministrativeMutationAccess,
  killPtyAtCurrentIncarnation,
  killPtyWithAdministrativeMutationAccess,
  writeImmediateCurrentPty,
  writeImmediateCurrentPtyAccepted,
  writePtyWithAdministrativeMutationAccess
} from './pty-administrative-mutations'

describe('PTY administrative mutations', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    ;(globalThis as { window: Window }).window = originalWindow
  })

  it('routes current-session operations through the explicit administrative API', async () => {
    const administrativeWriteImmediateCurrent = vi.fn()
    const administrativeWriteImmediateCurrentAccepted = vi.fn(async () => true)
    const captureAdministrativeMutationAccess = vi.fn(async () => [
      { id: 'pty-1', access: { mode: 'legacy' as const } }
    ])
    const administrativeKill = vi.fn(async () => undefined)
    ;(globalThis as { window: Window }).window = {
      api: {
        pty: {
          administrativeWriteImmediateCurrent,
          administrativeWriteImmediateCurrentAccepted,
          captureAdministrativeMutationAccess,
          administrativeKill
        }
      }
    } as unknown as Window

    writeImmediateCurrentPty('pty-1', 'input')
    await expect(writeImmediateCurrentPtyAccepted('pty-1', 'interrupt')).resolves.toBe(true)
    await killPtyAtCurrentIncarnation('pty-1')

    expect(administrativeWriteImmediateCurrent).toHaveBeenCalledWith('pty-1', 'input')
    expect(administrativeWriteImmediateCurrentAccepted).toHaveBeenCalledWith('pty-1', 'interrupt')
    expect(captureAdministrativeMutationAccess).toHaveBeenCalledWith(['pty-1'])
    expect(administrativeKill).toHaveBeenCalledWith('pty-1', { mode: 'legacy' })
  })

  it('keeps old preload peers on the legacy API without changing call shape', async () => {
    const write = vi.fn()
    const writeAccepted = vi.fn(async () => true)
    const kill = vi.fn(async () => undefined)
    ;(globalThis as { window: Window }).window = {
      api: { pty: { write, writeAccepted, kill } }
    } as unknown as Window

    writeImmediateCurrentPty('pty-1', 'input')
    await writeImmediateCurrentPtyAccepted('pty-1', 'interrupt')
    await killPtyAtCurrentIncarnation('pty-1')

    expect(write).toHaveBeenCalledWith('pty-1', 'input')
    expect(writeAccepted).toHaveBeenCalledWith('pty-1', 'interrupt')
    expect(kill).toHaveBeenCalledWith('pty-1')
  })

  it('preserves captured incarnation evidence across delayed write and kill dispatch', async () => {
    const access = {
      mode: 'exact' as const,
      evidence: { incarnationId: 'incarnation-1', paneGeneration: 7 }
    }
    const administrativeWrite = vi.fn()
    const administrativeKill = vi.fn(async () => undefined)
    ;(globalThis as { window: Window }).window = {
      api: {
        pty: { administrativeWrite, administrativeKill }
      }
    } as unknown as Window

    expect(writePtyWithAdministrativeMutationAccess('pty-reused', 'input', access)).toBe(true)
    await killPtyWithAdministrativeMutationAccess('pty-reused', access)

    expect(administrativeWrite).toHaveBeenCalledWith('pty-reused', 'input', access)
    expect(administrativeKill).toHaveBeenCalledWith('pty-reused', access)
  })

  it('fails closed when an old preload cannot carry exact evidence', async () => {
    const write = vi.fn()
    const kill = vi.fn(async () => undefined)
    const access = {
      mode: 'exact' as const,
      evidence: { incarnationId: 'incarnation-1' }
    }
    ;(globalThis as { window: Window }).window = {
      api: { pty: { write, writeAccepted: vi.fn(), kill } }
    } as unknown as Window

    expect(writePtyWithAdministrativeMutationAccess('pty-reused', 'input', access)).toBe(false)
    await expect(killPtyWithAdministrativeMutationAccess('pty-reused', access)).rejects.toThrow(
      'access_unsupported'
    )
    expect(write).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('marks omitted capture rows unavailable instead of inventing legacy access', async () => {
    ;(globalThis as { window: Window }).window = {
      api: {
        pty: {
          captureAdministrativeMutationAccess: vi.fn(async () => []),
          write: vi.fn(),
          writeAccepted: vi.fn(),
          kill: vi.fn()
        }
      }
    } as unknown as Window

    const access = await capturePtyAdministrativeMutationAccess(['missing'])

    expect(access.get('missing')).toBeUndefined()
  })
})
