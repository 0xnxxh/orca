import type { AppState } from '@/store'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import {
  getCodexSelectionLaneKey,
  normalizeCodexAccountSelectionTarget,
  type CodexAccountSelectionTarget
} from '../../../shared/codex-selection-lane'
import {
  isWslShellName,
  resolveLocalWindowsTerminalRuntimeOptions
} from '../../../shared/local-windows-terminal-runtime'
import { parseAppSshPtyId } from '../../../shared/ssh-pty-id'
import type { GlobalSettings, TerminalTab } from '../../../shared/types'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { parseWslUncPath } from '../../../shared/wsl-paths'
import { getLocalProjectExecutionRuntimeContext } from './local-preflight-context'

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
  // Why a family rather than the `wsl:__default__` key: a WSL target that names
  // no distro is resolved against the machine's own at write time. `add` stores
  // the concrete distro it found, and selecting the system default clears every
  // distro slot at once (setSelectedCodexAccountIdForTarget). Keying those to
  // `__default__` would miss the very panes the mutation re-pointed. The cost is
  // over-marking a sibling distro after an add — bounded to this machine's WSL
  // panes, and far cheaper than a stranded pane with no notice.
  if (normalized.runtime === 'wsl' && normalized.wslDistro === null) {
    return (laneKey) => laneKey.startsWith(WSL_LANE_PREFIX)
  }
  const switchLaneKey = getCodexSelectionLaneKey(normalized)
  return (laneKey) => laneKey === switchLaneKey
}

/** The lane a live pane resolves its Codex account from. */
export function resolveCodexPaneSelectionLaneKey(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'shellOverride' | 'worktreeId'>
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
 * Why the workspace path stands in for the PTY cwd: an explorer-created terminal
 * can start below the workspace root, but never outside it, so the WSL distro is
 * the same either way. Misreading a host pane as WSL would silently drop its
 * restart notice, so only the two signals a launch itself uses count as WSL.
 */
function resolveLocalPaneSelectionTarget(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'shellOverride' | 'worktreeId'>
}): CodexAccountSelectionTarget {
  const workspacePath = getWorkspacePath(args.state, args.tab.worktreeId)
  const wslPath = workspacePath ? parseWslUncPath(workspacePath) : null
  if (wslPath || isWslShellName(args.tab.shellOverride)) {
    return { runtime: 'wsl', wslDistro: wslPath?.distro ?? resolveLocalPaneWslDistro(args) }
  }
  return { runtime: 'host' }
}

/**
 * The distro a WSL launch on a Windows-path worktree resolved its account from.
 *
 * Why this is not optional: pty.ts hands the resolved runtime's distro to
 * getCodexSelectionTargetForPty as its third argument, so such a pane launches
 * under `wsl:<distro>`. Stopping at the UNC path would key it `wsl:__default__`,
 * and its own distro's switch would then never reach it — the pane keeps the old
 * account with no notice, which is the bug this guard exists to avoid causing.
 */
function resolveLocalPaneWslDistro(args: {
  state: CodexPaneLaneState
  tab: Pick<TerminalTab, 'shellOverride' | 'worktreeId'>
}): string | null {
  const projectRuntime = getLocalProjectExecutionRuntimeContext(args.state, args.tab.worktreeId)
  // Why handled here rather than below: resolveLocalWindowsTerminalRuntimeOptions
  // throws on repair-required, which is a spawn-time refusal, not a lane answer.
  if (projectRuntime?.status === 'repair-required') {
    return projectRuntime.repair.preferredRuntime.distro
  }
  return resolveLocalWindowsTerminalRuntimeOptions({
    requestedShellOverride: args.tab.shellOverride,
    settings: args.state.settings ?? undefined,
    projectRuntime
  }).terminalWindowsWslDistro
}

function getWorkspacePath(
  state: Pick<AppState, 'folderWorkspaces' | 'worktreesByRepo'>,
  worktreeId: string
): string | null {
  const parsed = parseWorkspaceKey(worktreeId)
  if (parsed?.type === 'folder') {
    return (
      state.folderWorkspaces.find((workspace) => workspace.id === parsed.folderWorkspaceId)
        ?.folderPath ?? null
    )
  }
  return (
    Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === worktreeId)?.path ?? null
  )
}
