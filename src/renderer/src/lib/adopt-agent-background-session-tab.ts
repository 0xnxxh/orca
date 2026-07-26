import type { useAppStore } from '@/store'
import { makePaneKey, type PaneKey } from '../../../shared/stable-pane-id'
import type { AgentType } from '../../../shared/agent-status-types'
import { bindAutomationTerminal } from '@/lib/automation-terminal-ownership'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { retireUnownedTerminal } from '@/lib/retire-unowned-background-terminal'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'

type Store = ReturnType<typeof useAppStore.getState>
type RegisterArgs = Parameters<Store['registerAgentLaunchConfig']>

/**
 * Reserves the run tab's identity and bakes it into the spawn env before the
 * PTY exists, so the tab can be created already bound once the spawn resolves.
 *
 * Why: createBrowserUuid, not crypto.randomUUID — the latter is undefined in
 * non-secure browser contexts such as the LAN web client served over plain HTTP.
 * Agent hook callbacks are keyed by pane, and background automation tabs never
 * mount a TerminalPane to inject this env for us.
 */
export function reserveAgentBackgroundSessionIdentity(args: {
  store: Store
  agentType: AgentType
  worktreeId: string
  launchConfig: RegisterArgs[1]
  env: Record<string, string> | undefined
}): {
  reservedTabId: string
  leafId: string
  paneKey: PaneKey
  launchToken: string
  launchRegistration: NonNullable<RegisterArgs[2]>
  paneEnv: Record<string, string>
} {
  const reservedTabId = createBrowserUuid()
  const leafId = createBrowserUuid()
  const paneKey = makePaneKey(reservedTabId, leafId)
  const launchToken = createBrowserUuid()
  const launchRegistration = {
    agentType: args.agentType,
    launchToken,
    tabId: reservedTabId,
    leafId
  }
  args.store.registerAgentLaunchConfig(paneKey, args.launchConfig, launchRegistration)
  return {
    reservedTabId,
    leafId,
    paneKey,
    launchToken,
    launchRegistration,
    paneEnv: {
      ...args.env,
      ORCA_PANE_KEY: paneKey,
      ORCA_TAB_ID: reservedTabId,
      ORCA_WORKTREE_ID: args.worktreeId,
      ORCA_AGENT_LAUNCH_TOKEN: launchToken
    }
  }
}

/**
 * Creates the hidden run tab already bound to a live PTY, or retires the PTY if
 * its worktree vanished across the spawn await.
 *
 * Why: no await may separate tab creation from its PTY binding. A worktree the
 * user has already visited is fully mounted, so Terminal.tsx renders a pane for
 * the new tab in the same pass; if that pane finds no PTY on the tab, in
 * ptyIdsByTabId, in the layout, or in an eager buffer, connectPanePty takes its
 * FRESH SPAWN branch and binds a default shell to the run tab — the agent PTY is
 * orphaned and the user sees a blank shell prompt (#2989).
 */
export async function adoptAgentBackgroundSessionTab(args: {
  store: Store
  worktreeId: string
  reservedTabId: string
  leafId: string
  ptyId: string
  paneKey: PaneKey
  launchConfig: RegisterArgs[1]
  launchRegistration: NonNullable<RegisterArgs[2]>
  runtimeTarget: RuntimeClientTarget
  runtimeTerminalHandle: string | null
  onRetire: () => void
  title?: string
}): Promise<{
  tab: ReturnType<Store['createTab']>
  paneKey: PaneKey
  terminalOwnership: ReturnType<typeof bindAutomationTerminal>
} | null> {
  const { store, reservedTabId, leafId, ptyId, launchRegistration } = args
  // Why: the run tab cannot be closed mid-spawn now that it is created after the
  // await, but the worktree can still disappear across it — adopting into a gone
  // worktree would strand a live PTY behind an unreachable tab.
  if (
    await retireUnownedTerminal({
      owner: { worktreeId: args.worktreeId },
      ptyId,
      runtimeTarget: args.runtimeTarget,
      runtimeTerminalHandle: args.runtimeTerminalHandle,
      onRetire: args.onRetire
    })
  ) {
    return null
  }
  const tab = store.createTab(args.worktreeId, undefined, undefined, {
    id: reservedTabId,
    initialPtyId: ptyId,
    activate: false,
    recordInteraction: false
  })
  let paneKey = args.paneKey
  if (tab.id !== reservedTabId) {
    // Why: createTab mints a fresh id on collision, so the env-baked paneKey no
    // longer routes; drop the stale registration before re-keying.
    store.clearAgentLaunchConfig(paneKey)
    paneKey = makePaneKey(tab.id, leafId)
    launchRegistration.tabId = tab.id
  }
  store.registerAgentLaunchConfig(paneKey, args.launchConfig, launchRegistration)
  const terminalOwnership = bindAutomationTerminal(
    tab,
    paneKey,
    ptyId,
    args.runtimeTarget.kind,
    args.title
  )
  return { tab, paneKey, terminalOwnership }
}
