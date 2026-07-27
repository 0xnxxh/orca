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
  const workspacePath = getWorkspacePath(args.state, args.tab.worktreeId)
  // Why this exact call: it is the same one main spawns through, so a relative
  // or inherited startup folder resolves to the identical absolute path.
  const paneCwd = workspacePath
    ? (resolveTerminalStartupCwd(workspacePath, args.tab.startupCwd) ?? workspacePath)
    : null
  const wslPath = paneCwd ? parseWslUncPath(paneCwd) : null
  const terminalRuntime = resolveLocalPaneTerminalRuntime(args)
  if (wslPath || isWslShellName(terminalRuntime.shellOverride)) {
    return {
      runtime: 'wsl',
      wslDistro: wslPath?.distro ?? terminalRuntime.terminalWindowsWslDistro
    }
  }
  return { runtime: 'host' }
}

/**
 * The shell and distro the launch resolved, not merely the ones the tab asked for.
 *
 * Why the tab's own fields are not enough: pty.ts runs the request through
 * resolveLocalWindowsTerminalRuntimeOptions and hands the result to
 * getCodexSelectionTargetForPty — so an unset shellOverride still lands on WSL
 * when that is the Windows default, and the distro comes from the resolved
 * runtime. Reading only the tab would key such a pane `host` (a host switch then
 * mutes a working WSL pane) or `wsl:__default__` (its own distro's switch never
 * reaches it, which is #10757 returning).
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
  const projectRuntime = getLocalProjectExecutionRuntimeContext(args.state, args.tab.worktreeId)
  if (projectRuntime?.status === 'repair-required') {
    // Why not delegate: resolveLocalWindowsTerminalRuntimeOptions throws here.
    // A spawn-time refusal is not a lane answer, and the pane still means WSL.
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
