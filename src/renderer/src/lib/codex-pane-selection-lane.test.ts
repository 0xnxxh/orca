import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store'
import { getCodexSelectionLaneKey } from '../../../shared/codex-selection-lane'
import {
  getCodexAccountSwitchLaneMatcher,
  isForeignMachineCodexPtyId,
  isLocalCodexSelectionLaneKey,
  resolveCodexPaneSelectionLaneKey
} from './codex-pane-selection-lane'

type LaneState = Pick<
  AppState,
  | 'activeRepoId'
  | 'activeWorktreeId'
  | 'folderWorkspaces'
  | 'projects'
  | 'repos'
  | 'settings'
  | 'worktreesByRepo'
>

function laneState(args?: {
  activeRuntimeEnvironmentId?: string | null
  worktreePath?: string
  folderPath?: string
  terminalWindowsWslDistro?: string | null
}): LaneState {
  return {
    folderWorkspaces: args?.folderPath ? [{ id: 'fw1', folderPath: args.folderPath }] : [],
    settings: {
      activeRuntimeEnvironmentId: args?.activeRuntimeEnvironmentId ?? null,
      terminalWindowsWslDistro: args?.terminalWindowsWslDistro ?? null
    },
    worktreesByRepo: {
      repo1: [{ id: 'wt1', path: args?.worktreePath ?? '/Users/dev/code/orca' }]
    }
  } as unknown as LaneState
}

const HOST_TAB = { worktreeId: 'wt1', shellOverride: undefined }

describe('resolveCodexPaneSelectionLaneKey', () => {
  it('keys an ordinary local pane to the host lane', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({ state: laneState(), tab: HOST_TAB, ptyId: 'pty-1' })
    ).toBe('host')
  })

  it('keys a pane in a WSL UNC worktree to that distro lane', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState({ worktreePath: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\orca' }),
        tab: HOST_TAB,
        ptyId: 'pty-1'
      })
    ).toBe('wsl:Ubuntu')
  })

  it('keys a wsl.exe pane outside a UNC worktree to the default WSL lane', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState(),
        tab: { worktreeId: 'wt1', shellOverride: 'wsl.exe' },
        ptyId: 'pty-1'
      })
    ).toBe('wsl:__default__')
  })

  // Why this matters: pty.ts keys such a pane `wsl:<distro>` from the resolved
  // runtime, so keying it `wsl:__default__` would make its own distro's switch
  // miss it — the pane keeps the old account with no notice.
  it('keys a wsl.exe pane on a Windows-path worktree to the configured distro', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState({ terminalWindowsWslDistro: 'Ubuntu' }),
        tab: { worktreeId: 'wt1', shellOverride: 'wsl.exe' },
        ptyId: 'pty-1'
      })
    ).toBe('wsl:Ubuntu')
  })

  it('still keys an ordinary host pane to host when a WSL distro is configured', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState({ terminalWindowsWslDistro: 'Ubuntu' }),
        tab: HOST_TAB,
        ptyId: 'pty-1'
      })
    ).toBe('host')
  })

  it('reads the distro from a folder workspace path too', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState({ folderPath: '\\\\wsl$\\Debian\\srv\\app' }),
        tab: { worktreeId: 'folder:fw1', shellOverride: undefined },
        ptyId: 'pty-1'
      })
    ).toBe('wsl:Debian')
  })

  it('keys an owned remote runtime pane to its own environment, not the active one', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState({ activeRuntimeEnvironmentId: 'env-active' }),
        tab: HOST_TAB,
        ptyId: 'remote:env-owner@@term-1'
      })
    ).toBe('env:env-owner')
  })

  it('routes an owner-less remote pane to the active environment, as inspection does', () => {
    expect(
      resolveCodexPaneSelectionLaneKey({
        state: laneState({ activeRuntimeEnvironmentId: 'env-1' }),
        tab: HOST_TAB,
        ptyId: 'remote:term-1'
      })
    ).toBe('env:env-1')
  })

  it('keeps an owner-less remote pane off the host lane when no environment is active', () => {
    const laneKey = resolveCodexPaneSelectionLaneKey({
      state: laneState(),
      tab: HOST_TAB,
      ptyId: 'remote:term-1'
    })
    // Why assert disjointness rather than the literal key: colliding with `host`
    // is the whole failure mode — a local switch would mute a working remote pane.
    expect(laneKey).not.toBe(getCodexSelectionLaneKey({ runtime: 'host' }))
    expect(isLocalCodexSelectionLaneKey(laneKey)).toBe(false)
  })

  it('keys an SSH-connection pane to a lane no account selection can name', () => {
    const laneKey = resolveCodexPaneSelectionLaneKey({
      state: laneState(),
      tab: HOST_TAB,
      ptyId: 'ssh:my-box@@pty-7'
    })
    expect(laneKey).toBe('ssh-connection')
    // Why: managed Codex accounts are only ever 'host' or 'wsl:<distro>', so no
    // switch can produce this key — the pane is unreachable by any selection.
    expect(laneKey).not.toBe(getCodexSelectionLaneKey({ runtime: 'host' }))
    expect(isLocalCodexSelectionLaneKey(laneKey)).toBe(false)
  })
})

describe('getCodexAccountSwitchLaneMatcher', () => {
  it('scopes a local switch to the runtime slot it wrote', () => {
    const hostSwitch = getCodexAccountSwitchLaneMatcher({
      settings: null,
      target: { runtime: 'host' }
    })
    expect(hostSwitch('host')).toBe(true)
    expect(hostSwitch('wsl:Ubuntu')).toBe(false)

    const ubuntuSwitch = getCodexAccountSwitchLaneMatcher({
      settings: null,
      target: { runtime: 'wsl', wslDistro: 'Ubuntu' }
    })
    expect(ubuntuSwitch('wsl:Ubuntu')).toBe(true)
    expect(ubuntuSwitch('wsl:Debian')).toBe(false)
    expect(ubuntuSwitch('host')).toBe(false)
  })

  // Why a family: selecting the system default with no distro clears EVERY wsl
  // slot, and `add` stores the concrete distro it discovered. Matching only
  // `wsl:__default__` would leave those panes stranded with no notice.
  it('claims every WSL distro when the switch named none', () => {
    const wslDefaultSwitch = getCodexAccountSwitchLaneMatcher({
      settings: null,
      target: { runtime: 'wsl', wslDistro: null }
    })
    expect(wslDefaultSwitch('wsl:__default__')).toBe(true)
    expect(wslDefaultSwitch('wsl:Ubuntu')).toBe(true)
    expect(wslDefaultSwitch('wsl:Debian')).toBe(true)
    // Still cannot reach another machine, which is the point of the guard.
    expect(wslDefaultSwitch('host')).toBe(false)
    expect(wslDefaultSwitch('env:env-1')).toBe(false)
    expect(wslDefaultSwitch('ssh-connection')).toBe(false)
    expect(wslDefaultSwitch('remote-runtime')).toBe(false)
  })

  it('scopes a switch made against a runtime environment to that machine', () => {
    const environmentSwitch = getCodexAccountSwitchLaneMatcher({
      settings: { activeRuntimeEnvironmentId: 'env-1' },
      target: { runtime: 'host' }
    })
    expect(environmentSwitch('env:env-1')).toBe(true)
    expect(environmentSwitch('host')).toBe(false)
    expect(environmentSwitch('env:env-2')).toBe(false)
  })

  it('never lets a local host switch claim a remote or SSH pane', () => {
    const hostSwitch = getCodexAccountSwitchLaneMatcher({
      settings: null,
      target: { runtime: 'host' }
    })
    const state = laneState()
    for (const ptyId of ['remote:env-owner@@term-1', 'remote:term-1', 'ssh:my-box@@pty-7']) {
      expect(hostSwitch(resolveCodexPaneSelectionLaneKey({ state, tab: HOST_TAB, ptyId }))).toBe(
        false
      )
    }
  })
})

describe('isForeignMachineCodexPtyId', () => {
  it('separates panes whose shell runs on another machine from local ones', () => {
    expect(isForeignMachineCodexPtyId('remote:env-1@@term-1')).toBe(true)
    expect(isForeignMachineCodexPtyId('remote:term-1')).toBe(true)
    expect(isForeignMachineCodexPtyId('ssh:my-box@@pty-7')).toBe(true)
    expect(isForeignMachineCodexPtyId('pty-1')).toBe(false)
  })

  it('agrees with the lane keys, so the sweep and the scan skip the same panes', () => {
    const state = laneState({ activeRuntimeEnvironmentId: 'env-1' })
    for (const ptyId of ['remote:env-1@@term-1', 'remote:term-1', 'ssh:my-box@@pty-7', 'pty-1']) {
      expect(
        isLocalCodexSelectionLaneKey(
          resolveCodexPaneSelectionLaneKey({ state, tab: HOST_TAB, ptyId })
        )
      ).toBe(!isForeignMachineCodexPtyId(ptyId))
    }
  })
})
