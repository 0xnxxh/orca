// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../shared/renderer-shutdown-events'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('node-pty', () => ({ spawn: spawnMock }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/orca-test' } }))
vi.mock('../providers/macos-tcc-login-shell', () => ({
  prepareMacosTccLoginShell: () => Promise.resolve(),
  wrapShellSpawnForMacosTccAttribution: (file: string, args: string[]) => ({ file, args })
}))
vi.mock('../pty/posix-pty-process-groups', () => ({
  forceKillPosixPtyProcessGroups: (_pid: number, killRoot: () => void) => killRoot()
}))

import {
  _resetLocalPtyProviderStateForTest,
  LocalPtyProvider
} from '../providers/local-pty-provider'
import { requestLazyChunkRecoveryReload } from '../../renderer/src/lib/lazy-chunk-recovery-reload'
import { createRecoveryReloadIntent } from '../window/recovery-reload-intent'
import { handleLocalPtyRendererLoad } from './local-pty-renderer-load'

describe('lazy chunk recovery local PTY load', () => {
  const webContentsId = 7
  const kill = vi.fn()
  const proc = {
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    write: vi.fn(),
    resize: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    kill,
    process: 'zsh',
    pid: 12345
  }

  async function spawnStaleGenerationPty(provider: LocalPtyProvider): Promise<string> {
    const spawned = await provider.spawn({ cols: 80, rows: 24 })
    handleLocalPtyRendererLoad(provider, webContentsId, () => true)
    await provider.spawn({ cols: 100, rows: 30, sessionId: spawned.id })
    return spawned.id
  }

  beforeEach(() => {
    kill.mockReset()
    proc.resize.mockReset()
    spawnMock.mockReset().mockReturnValue(proc)
  })

  afterEach(() => {
    _resetLocalPtyProviderStateForTest()
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('preserves a re-adopted older-generation PTY across lazy recovery', async () => {
    const provider = new LocalPtyProvider()
    const spawnedId = await spawnStaleGenerationPty(provider)

    const intent = createRecoveryReloadIntent({
      now: () => 100,
      createToken: () => 'intent-1',
      durationMs: 50
    })
    Object.assign(window, {
      api: {
        app: {
          beginLazyChunkRecoveryReload: async () => intent.begin(webContentsId),
          cancelLazyChunkRecoveryReload: async (token: string) =>
            intent.cancel(webContentsId, token)
        }
      }
    })
    vi.spyOn(window.location, 'reload').mockImplementation(() => {
      handleLocalPtyRendererLoad(provider, webContentsId, (id) => intent.consume(id))
      window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
    })

    await expect(requestLazyChunkRecoveryReload(window, async () => undefined)).resolves.toBe(
      'unload-vetoed'
    )

    expect(kill).not.toHaveBeenCalled()
    expect(provider.hasPty(spawnedId)).toBe(true)
  })

  it('cancels a non-landing intent before a later genuine load', async () => {
    const provider = new LocalPtyProvider()
    await spawnStaleGenerationPty(provider)

    const intent = createRecoveryReloadIntent({
      now: () => 100,
      createToken: () => 'intent-1',
      durationMs: 50
    })
    Object.assign(window, {
      api: {
        app: {
          beginLazyChunkRecoveryReload: async () => intent.begin(webContentsId),
          cancelLazyChunkRecoveryReload: async (token: string) =>
            intent.cancel(webContentsId, token)
        }
      }
    })
    vi.spyOn(window.location, 'reload').mockImplementation(() => {
      window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
    })

    await expect(requestLazyChunkRecoveryReload(window, async () => undefined)).resolves.toBe(
      'unload-vetoed'
    )
    handleLocalPtyRendererLoad(provider, webContentsId, (id) => intent.consume(id))

    expect(kill).toHaveBeenCalledTimes(1)
  })
})
