import type { AppState } from '@/store'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import {
  getCodexSelectionLaneKey,
  normalizeCodexAccountSelectionTarget,
  type CodexAccountSelectionTarget
} from '../../../shared/codex-selection-lane'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  isWslShellName,
  resolveLocalWindowsTerminalRuntimeOptions,
  type LocalWindowsTerminalRuntimeOptions
} from '../../../shared/local-windows-terminal-runtime'
import { parseAppSshPtyId } from '../../../shared/ssh-pty-id'
import { resolveTerminalStartupCwd } from '../../../shared/terminal-startup-cwd'
import type { GlobalSettings, TerminalTab } from '../../../shared/types'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { parseWslUncPath } from '../../../shared/wsl-paths'
import { getLocalProjectExecutionRuntimeContext } from './local-preflight-context'
import { getRendererAppPlatform } from './renderer-app-platform'
import {
  getCachedWindowsTerminalCapabilities,
  hasCachedWindowsTerminalCapabilities
} from './windows-terminal-capabilities'

type RuntimeEnvironmentSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>

/** Everything the pane lane needs: the workspace path plus the project runtime inputs. */
type CodexPaneLaneState = Pick<
  AppState,
  | 'activeRepoId'
  | 'activeWorktreeId'
  | 'folderWorkspaces'
  | 'projects'
  | 'repos'
  | 'settings'
  | 'worktreesByRepo'
>

/**
 * Lane keys for panes whose Codex credentials come from another machine.
 *
 * Why they need keys at all: a managed Codex account is scoped to one machine
 * AND one runtime (`host` or `wsl:<distro>`). A relay environment keeps its own
 * account roster, and an SSH connection has no Orca-managed selection whatsoever
 * — the remote Codex reads that machine's own credentials. Neither can be
 * stranded by a local selection change, so they must not share the local keys.
 */
const RUNTIME_ENVIRONMENT_LANE_PREFIX = 'env:'
const SSH_CONNECTION_LANE_KEY = 'ssh-connection'
const UNATTRIBUTED_REMOTE_LANE_KEY = 'remote-runtime'
const HOST_LANE_KEY = 'host'
const WSL_LANE_PREFIX = 'wsl:'

/** True for the lanes an on-disk pane-account record can name. */
export function isLocalCodexSelectionLaneKey(laneKey: string): boolean {
  return laneKey === HOST_LANE_KEY || laneKey.startsWith(WSL_LANE_PREFIX)
}

/**
 * True when the pane's shell runs on a machine other than this one.
 *
 * Why it takes only the id: a `remote:`/`ssh:` prefix is assigned at spawn and
 * is decisive on its own, so callers with no store access (the bind-driven
 * sweep) can skip these panes before spending a 15s RPC on them.
 */
export function isForeignMachineCodexPtyId(ptyId: string): boolean {
  return parseRemoteRuntimePtyId(ptyId) !== null || parseAppSshPtyId(ptyId) !== null
}

/** Matches the panes a Codex account mutation could have re-pointed. */
export function getCodexAccountSwitchLaneMatcher(args: {
  settings: RuntimeEnvironmentSettings | null | undefined
  target?: CodexAccountSelectionTarget | null
  /**
   * True only when the mutation cleared every WSL distro slot at once, which
   * setSelectedCodexAccountIdForTarget does for a null account on a distro-less
   * WSL target. Any other write lands in a single slot, so defaulting this to
   * false keeps the matcher from muting a sibling distro's healthy panes.
   */
  clearsEveryWslDistro?: boolean
}): (laneKey: string) => boolean {
  const runtimeTarget = getActiveRuntimeTarget(args.settings)
  // Why: with an environment active the mutation is RPC'd to that machine's
  // roster and local GlobalSettings are never touched, so the local host/WSL
  // panes are exactly the ones the switch cannot have affected.
  if (runtimeTarget.kind === 'environment') {
    const environmentLaneKey = `${RUNTIME_ENVIRONMENT_LANE_PREFIX}${runtimeTarget.environmentId}`
    return (laneKey) => laneKey === environmentLaneKey
  }
  const normalized = normalizeCodexAccountSelectionTarget(args.target)
  // Why a family rather than the `wsl:__default__` key: clearing a distro-less
  // WSL selection nulls every distro slot, so every WSL pane really is stranded.
  // Keying that to `__default__` alone would leave them all without a notice.
  if (args.clearsEveryWslDistro && normalized.runtime === 'wsl' && normalized.wslDistro === null) {
    return (laneKey) => laneKey.startsWith(WSL_LANE_PREFIX)
  }
  const switchLaneKey = getCodexSelectionLaneKey(normalized)
  return (laneKey) => laneKey === switchLaneKey
}

/** The lane a live pane resolves its Codex account from. */
export function resolveCodexPaneSelectionLaneKey(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'shellOverride' | 'startupCwd' | 'worktreeId'>
  ptyId: string
}): string {
  const remoteParts = parseRemoteRuntimePtyId(args.ptyId)
  if (remoteParts !== null) {
    const runtimeTarget = getActiveRuntimeTarget(args.state.settings)
    // Why: mirror inspectRuntimeTerminalProcess — an owner-less remote id is
    // routed to whichever environment is active, so that is its lane too.
    const environmentId =
      remoteParts.environmentId?.trim() ||
      (runtimeTarget.kind === 'environment' ? runtimeTarget.environmentId : null)
    return environmentId
      ? `${RUNTIME_ENVIRONMENT_LANE_PREFIX}${environmentId}`
      : UNATTRIBUTED_REMOTE_LANE_KEY
  }
  if (parseAppSshPtyId(args.ptyId) !== null) {
    return SSH_CONNECTION_LANE_KEY
  }
  return getCodexSelectionLaneKey(resolveLocalPaneSelectionTarget(args))
}

/**
 * Mirrors the main-process getCodexSelectionTargetForPty, from renderer state.
 *
 * Why the pane cwd and not the workspace root: a terminal's startup cwd is
 * deliberately NOT constrained to the worktree (see resolveTerminalStartupCwd,
 * #7685), so a pane split after `cd \\wsl.localhost\...` runs on a different
 * filesystem than its workspace. Main keys the lane off that cwd, so reading the
 * root instead would call a live WSL pane `host` and mute it on a host switch.
 */
function resolveLocalPaneSelectionTarget(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'shellOverride' | 'startupCwd' | 'worktreeId'>
}): CodexAccountSelectionTarget {
  const paneCwd = resolvePaneCwd(args)
  const wslPath = paneCwd ? parseWslUncPath(paneCwd) : null
  if (wslPath) {
    return { runtime: 'wsl', wslDistro: wslPath.distro }
  }
  const terminalRuntime = resolveLocalPaneTerminalRuntime(args)
  if (isWslShellName(terminalRuntime.shellOverride)) {
    return { runtime: 'wsl', wslDistro: terminalRuntime.terminalWindowsWslDistro }
  }
  return { runtime: 'host' }
}

/** The absolute directory the pane's shell was spawned in, as main resolved it. */
function resolvePaneCwd(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'startupCwd' | 'worktreeId'>
}): string | null {
  // Why floating terminals short-circuit: they have no workspace root, and
  // resolveTerminalStartupCwdForWorkspace returns their requested cwd verbatim.
  if (args.tab.worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return args.tab.startupCwd ?? null
  }
  const workspacePath = getWorkspacePath(args.state, args.tab.worktreeId)
  if (!workspacePath) {
    return null
  }
  // Why this exact call: it is the same one main spawns through, so a relative
  // or inherited startup folder resolves to the identical absolute path.
  return resolveTerminalStartupCwd(workspacePath, args.tab.startupCwd) ?? workspacePath
}

/**
 * The shell and distro the launch resolved, not merely the ones the tab asked for.
 *
 * Why getLocalProjectExecutionRuntimeContext specifically: for a local pane the
 * RENDERER computes the project runtime and ships it with the spawn
 * (pty-connection.ts), so this is not an approximation of main — it is the same
 * call on the same state. Re-deriving it by hand drops the global WSL default,
 * which turns `inherit-global` into WSL and would key a live WSL pane `host`.
 */
function resolveLocalPaneTerminalRuntime(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'shellOverride' | 'startupCwd' | 'worktreeId'>
}): LocalWindowsTerminalRuntimeOptions {
  // Why the platform gate: pty.ts only consults the Windows terminal runtime on
  // win32, so elsewhere the tab's own override is the whole answer.
  if (getRendererAppPlatform() !== 'win32') {
    return { shellOverride: args.tab.shellOverride, terminalWindowsWslDistro: null }
  }
  const capabilities = hasCachedWindowsTerminalCapabilities()
    ? getCachedWindowsTerminalCapabilities()
    : null
  const projectRuntime = getLocalProjectExecutionRuntimeContext(
    args.state,
    args.tab.worktreeId,
    undefined,
    {
      wslAvailable: capabilities?.wslAvailable,
      availableWslDistros: capabilities?.wslDistros ?? null
    }
  )
  if (projectRuntime?.status === 'repair-required') {
    // Why not delegate: resolveLocalWindowsTerminalRuntimeOptions throws here,
    // and this call sits outside the scan's per-pane failure guard, so a throw
    // would lose the notice for every pane in the batch, not just this one.
    return {
      shellOverride: 'wsl.exe',
      terminalWindowsWslDistro: projectRuntime.repair.preferredRuntime.distro
    }
  }
  return resolveLocalWindowsTerminalRuntimeOptions({
    requestedShellOverride: args.tab.shellOverride,
    settings: args.state.settings ?? undefined,
    projectRuntime
  })
}

function getWorkspacePath(
  state: Pick<AppState, 'folderWorkspaces' | 'worktreesByRepo'>,
  worktreeId: string
): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  if (parsed?.type === 'folder') {
    return (
      (state.folderWorkspaces ?? []).find((workspace) => workspace.id === parsed.folderWorkspaceId)
        ?.folderPath ?? null
    )
  }
  return (
    Object.values(state.worktreesByRepo ?? {})
      .flat()
      .find((entry) => entry.id === worktreeId)?.path ?? null
  )
}
