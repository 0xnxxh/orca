import type { AppState } from '@/store'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import {
  getCodexSelectionLaneKey,
  normalizeCodexAccountSelectionTarget,
  type CodexAccountSelectionTarget
} from '../../../shared/codex-selection-lane'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { isWslShellName } from '../../../shared/local-windows-terminal-runtime'
import { parseAppSshPtyId } from '../../../shared/ssh-pty-id'
import { resolveTerminalStartupCwd } from '../../../shared/terminal-startup-cwd'
import type { GlobalSettings, TerminalTab } from '../../../shared/types'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { parseWslUncPath } from '../../../shared/wsl-paths'
import { getRendererAppPlatform } from './renderer-app-platform'

type RuntimeEnvironmentSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>

/** Everything the pane lane needs: the workspace path plus the project runtime inputs. */
type CodexPaneLaneState = Pick<
  AppState,
  'folderWorkspaces' | 'projects' | 'repos' | 'settings' | 'worktreesByRepo'
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
  const workspacePath = getWorkspacePath(args.state, args.tab.worktreeId)
  // Why this exact call: it is the same one main spawns through, so a relative
  // or inherited startup folder resolves to the identical absolute path.
  const paneCwd = workspacePath
    ? (resolveTerminalStartupCwd(workspacePath, args.tab.startupCwd) ?? workspacePath)
    : null
  const wslPath = paneCwd ? parseWslUncPath(paneCwd) : null
  if (wslPath) {
    return { runtime: 'wsl', wslDistro: wslPath.distro }
  }
  // Why the platform gate: pty.ts only consults the Windows terminal runtime on
  // win32, so elsewhere the tab's own override is the whole answer.
  if (getRendererAppPlatform() !== 'win32') {
    return isWslShellName(args.tab.shellOverride)
      ? { runtime: 'wsl', wslDistro: null }
      : { runtime: 'host' }
  }
  const projectWslDistro = resolveProjectWslDistro(args.state, args.tab.worktreeId)
  // Why the settings shell too: main resolves `requestedShellOverride ?? settingsShell`,
  // so an unset override still means WSL when that is the Windows default. Reading
  // only the tab would key such a pane `host` and mute it on a host switch.
  const shell = args.tab.shellOverride ?? args.state.settings?.terminalWindowsShell
  if (projectWslDistro === null && !isWslShellName(shell)) {
    return { runtime: 'host' }
  }
  return {
    runtime: 'wsl',
    wslDistro: projectWslDistro ?? args.state.settings?.terminalWindowsWslDistro ?? null
  }
}

/**
 * The WSL distro a project runtime pins this pane to, or null for none.
 *
 * Why this walks repo -> project by hand instead of calling
 * getLocalProjectExecutionRuntimeContext: that helper falls back to the ACTIVE
 * repo when the worktree is not a git worktree, so a folder-workspace pane would
 * take whichever repo happens to be selected — a lane that changes under the
 * pane. It also synthesizes a runtime where main has none. Main resolves
 * strictly repo -> project (resolveLocalProjectRuntimeForRepo), so mirror that.
 */
function resolveProjectWslDistro(state: CodexPaneLaneState, worktreeId: string): string | null {
  const worktree = Object.values(state.worktreesByRepo ?? {})
    .flat()
    .find((entry) => entry.id === worktreeId)
  const repo = worktree ? (state.repos ?? []).find((entry) => entry.id === worktree.repoId) : null
  if (!repo || getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
    return null
  }
  const preference = (state.projects ?? []).find((entry) =>
    entry.sourceRepoIds?.includes(repo.id)
  )?.localWindowsRuntimePreference
  return preference?.kind === 'wsl' ? (preference.distro ?? null) : null
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
