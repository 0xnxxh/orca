import { describe, expect, it, vi } from 'vitest'

import type { PtyProcessInfo } from '../providers/pty-process-info'
import { reconcileWslHookRelaysOnStartup } from './wsl-hook-relay-startup-reconciliation'

function session(id: string, wslDistro?: string | null): PtyProcessInfo {
  return {
    id,
    cwd: '',
    title: 'shell',
    ...(wslDistro !== undefined ? { wslDistro } : {})
  }
}

describe('reconcileWslHookRelaysOnStartup', () => {
  it('groups surviving panes by distro and awaits one relay per distro', async () => {
    const events: string[] = []
    const releases = new Map<string, () => void>()
    const ensureForDistro = vi.fn(
      (distro: string) =>
        new Promise<void>((resolve) => {
          events.push(`ensure:${distro}`)
          releases.set(distro, resolve)
        })
    )
    const listRunningDistros = vi.fn(async () => ['Ubuntu', 'Debian'])

    const reconciliation = reconcileWslHookRelaysOnStartup({
      platform: 'win32',
      listLiveProcesses: async () => [
        session('pane-1', 'Ubuntu'),
        session('pane-2', 'ubuntu'),
        session('pane-3', 'Debian')
      ],
      listRunningDistros,
      ensureForDistro
    }).then(() => events.push('ready'))

    await vi.waitFor(() => expect(events).toEqual(['ensure:Ubuntu', 'ensure:Debian']))
    releases.get('Ubuntu')?.()
    await Promise.resolve()
    expect(events).not.toContain('ready')
    releases.get('Debian')?.()
    await reconciliation

    expect(events).toEqual(['ensure:Ubuntu', 'ensure:Debian', 'ready'])
    expect(listRunningDistros).toHaveBeenCalledOnce()
  })

  it('ignores native panes, blank values, and old daemons without WSL metadata', async () => {
    const ensureForDistro = vi.fn(async () => {})

    await reconcileWslHookRelaysOnStartup({
      platform: 'win32',
      listLiveProcesses: async () => [
        session('native', null),
        session('old-daemon'),
        session('blank', '  ')
      ],
      listRunningDistros: vi.fn(async () => ['Ubuntu']),
      ensureForDistro
    })

    expect(ensureForDistro).not.toHaveBeenCalled()
  })

  it('does not infer desired distros from unavailable inventory', async () => {
    const ensureForDistro = vi.fn(async () => {})

    await reconcileWslHookRelaysOnStartup({
      platform: 'win32',
      listLiveProcesses: async () => null,
      listRunningDistros: vi.fn(async () => ['Ubuntu']),
      ensureForDistro
    })

    expect(ensureForDistro).not.toHaveBeenCalled()
  })

  it('does not query local daemon inventory on native hosts', async () => {
    const listLiveProcesses = vi.fn(async () => [session('remote', 'Ubuntu')])

    await reconcileWslHookRelaysOnStartup({ platform: 'linux', listLiveProcesses })
    await reconcileWslHookRelaysOnStartup({ platform: 'darwin', listLiveProcesses })

    expect(listLiveProcesses).not.toHaveBeenCalled()
  })

  it('does not boot a distro that stopped after the live inventory was captured', async () => {
    const ensureForDistro = vi.fn(async () => {})

    await reconcileWslHookRelaysOnStartup({
      platform: 'win32',
      listLiveProcesses: async () => [session('survivor', 'Ubuntu')],
      listRunningDistros: async () => [],
      ensureForDistro
    })

    expect(ensureForDistro).not.toHaveBeenCalled()
  })

  it('fails closed when the running-distro snapshot is unavailable', async () => {
    const ensureForDistro = vi.fn(async () => {})

    await reconcileWslHookRelaysOnStartup({
      platform: 'win32',
      listLiveProcesses: async () => [session('survivor', 'Ubuntu')],
      listRunningDistros: async () => null,
      ensureForDistro
    })

    expect(ensureForDistro).not.toHaveBeenCalled()
  })

  it('uses live ownership for folder workspace sessions without parsing their ids', async () => {
    const ensureForDistro = vi.fn(async () => {})

    await reconcileWslHookRelaysOnStartup({
      platform: 'win32',
      listLiveProcesses: async () => [session('folder-workspace@@pane', 'Ubuntu-24.04')],
      listRunningDistros: async () => ['Ubuntu-24.04'],
      ensureForDistro
    })

    expect(ensureForDistro).toHaveBeenCalledWith('Ubuntu-24.04')
  })
})
