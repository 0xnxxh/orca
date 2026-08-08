import { useAppStore } from '@/store'
import type {
  LaunchAgentBackgroundSessionArgs,
  LaunchAgentBackgroundSessionResult
} from '@/lib/agent-background-session-contract'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { scheduleAgentBackgroundDraft } from '@/lib/agent-background-draft-delivery'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import { resolveAgentBackgroundLaunchHost } from '@/lib/agent-background-session-launch-host'
import { makePaneKey } from '../../../shared/stable-pane-id'
import {
  registerEagerPtyBuffer,
  subscribeToPtyExit,
  type EagerPtyHandle
} from '@/components/terminal-pane/pty-dispatcher'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { retireProvider } from '@/lib/retire-unowned-background-terminal'
import { createRuntimeAgentBackgroundTerminal } from '@/lib/runtime-agent-background-create'
import {
  subscribeToRuntimeTerminalData,
  toRemoteRuntimePtyId
} from '@/runtime/runtime-terminal-stream'
import { createSshBackgroundStartupDelivery } from '@/lib/ssh-background-startup-delivery'
import { shouldUseShellReadyStartupDelivery } from '../../../shared/codex-startup-delivery'
import { isMainTerminalSideEffectAuthorityForPty } from '@/components/terminal-pane/terminal-side-effect-facts-handler'
import { cleanupFailedAgentBackgroundSession } from '@/lib/agent-background-session-failure-cleanup'
import { prepareAgentBackgroundSessionStartup } from '@/lib/agent-background-session-startup-plan'
import type { bindAutomationTerminal } from '@/lib/automation-terminal-ownership'
import {
  adoptAgentBackgroundSessionTab,
  reserveAgentBackgroundSessionIdentity
} from '@/lib/adopt-agent-background-session-tab'
import { createBackgroundAgentStatusConsumer } from '@/lib/background-agent-status-consumer'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { writePtyWithAdministrativeMutationAccess } from '@/lib/pty-administrative-mutations'
import type { PtyAdministrativeMutationAccess } from '../../../shared/pty-mutation-identity'
import { createAgentBackgroundSessionExitHandler } from '@/lib/agent-background-session-exit-handler'

export async function launchAgentBackgroundSession(
  args: LaunchAgentBackgroundSessionArgs
): Promise<LaunchAgentBackgroundSessionResult | null> {
  const { agent, worktreeId, prompt, launchSource, title, onData, onExit, onAgentStatus } = args
  const store = useAppStore.getState()
  // Folder workspaces exist only in getKnownWorktreeById (#2989).
  const worktree = store.getKnownWorktreeById(worktreeId)
  const repo = worktree ? store.repos.find((entry) => entry.id === worktree.repoId) : null
  if (!worktree) {
    throw new Error('The target workspace is no longer available.')
  }
  // Folder launch ownership cannot be derived from a repo row (#2989).
  const launchHost = resolveAgentBackgroundLaunchHost({
    store,
    worktreeId,
    worktreePath: worktree.path,
    repo
  })
  const startup = await prepareAgentBackgroundSessionStartup({
    store,
    agent,
    worktreePath: worktree.path,
    launchHost,
    prompt
  })
  if (!startup) {
    return null
  }
  const { startupPlan, trimmedPrompt, hasPrompt, isFollowupPath, pasteDraftAfterLaunch } = startup

  // A hidden run tab must never be store-visible without its PTY (#2989).
  const { reservedTabId, leafId, launchToken, launchRegistration, paneEnv } =
    reserveAgentBackgroundSessionIdentity({
      store,
      agentType: agent,
      worktreeId,
      launchConfig: startupPlan.launchConfig,
      env: startupPlan.env
    })
  let paneKey = makePaneKey(reservedTabId, leafId)
  const sshConnectionId = launchHost.connectionId
  let startupMutationAccess: PtyAdministrativeMutationAccess = { mode: 'unavailable' }
  const sshStartupDelivery = createSshBackgroundStartupDelivery({
    command: sshConnectionId ? startupPlan.launchCommand : null,
    waitForShellReady:
      Boolean(sshConnectionId) &&
      shouldUseShellReadyStartupDelivery({
        command: startupPlan.launchCommand,
        startupCommandDelivery: startupPlan.startupCommandDelivery
      }),
    write: (ptyId, data) => {
      writePtyWithAdministrativeMutationAccess(ptyId, data, startupMutationAccess)
    }
  })
  // Route by the worktree's owner host, not the focused runtime.
  const runtimeTarget = getActiveRuntimeTarget(
    getSettingsForWorktreeRuntimeOwner(store, worktreeId)
  )
  let ptyId = '',
    runtimeTerminalHandle: string | null = null
  let returnedLaunchConfig: typeof startupPlan.launchConfig | undefined
  let tab: ReturnType<typeof store.createTab> | null = null
  let exitHandled = false,
    eagerPtyBuffer: EagerPtyHandle | null = null
  let terminalOwnership: ReturnType<typeof bindAutomationTerminal> = null
  let unsubscribeExit = (): void => {},
    unsubscribeData = (): void => {}
  const handleExit = createAgentBackgroundSessionExitHandler({
    isHandled: () => exitHandled,
    markHandled: () => {
      exitHandled = true
    },
    unsubscribeExit: () => unsubscribeExit(),
    unsubscribeData: () => unsubscribeData(),
    clearStartupDelivery: () => sshStartupDelivery.clear(),
    getTabId: () => tab?.id ?? null,
    clearTabPtyId: (tabId, exitPtyId) => useAppStore.getState().clearTabPtyId(tabId, exitPtyId),
    clearAgentLaunchConfig: () => useAppStore.getState().clearAgentLaunchConfig(paneKey),
    onExit
  })
  // Why: local/SSH status facts already pass through main's authoritative
  // scanner; remote-runtime bytes still need this renderer-side store write.
  const mainOwnsAgentStatusWrites = isMainTerminalSideEffectAuthorityForPty({
    settings: store.settings,
    runtimeEnvironmentId: runtimeTarget.kind === 'environment' ? runtimeTarget.environmentId : null
  })
  const agentStatusConsumer = createBackgroundAgentStatusConsumer({
    paneKey,
    launchToken,
    mainOwnsAgentStatusWrites,
    expectedConnectionId: launchHost.expectedConnectionId,
    runtimeEnvironmentId: runtimeTarget.kind === 'environment' ? runtimeTarget.environmentId : null,
    getPtyId: () => ptyId,
    onAgentStatus
  })
  const handleData = (data: string): void => {
    data = sshStartupDelivery.handleData(data)
    onData?.(data)
    sshStartupDelivery.schedule(ptyId)
    agentStatusConsumer.consume(data)
  }
  try {
    if (runtimeTarget.kind === 'environment') {
      // Why: runtime environments execute on the server; using local pty.spawn
      // would silently run automation on the client for a remote workspace.
      const created = await createRuntimeAgentBackgroundTerminal({
        environmentId: runtimeTarget.environmentId,
        worktreeId,
        tabId: reservedTabId,
        leafId,
        agent,
        ...(hasPrompt && !isFollowupPath ? { prompt: trimmedPrompt } : {}),
        ...(startupPlan.sessionOptions ? { sessionOptions: startupPlan.sessionOptions } : {}),
        legacy: {
          command: startupPlan.launchCommand,
          env: paneEnv,
          ...(startupPlan.startupCommandDelivery
            ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
            : {}),
          launchConfig: startupPlan.launchConfig,
          launchToken,
          ...(title ? { title } : {})
        }
      })
      runtimeTerminalHandle = created.terminal.handle
      ptyId = toRemoteRuntimePtyId(runtimeTerminalHandle, runtimeTarget.environmentId)
    } else {
      const result = await window.api.pty.spawn({
        cols: 120,
        rows: 40,
        cwd: worktree.path,
        command: startupPlan.launchCommand,
        ...(!sshConnectionId && isWslUncPath(worktree.path) ? { shellOverride: 'wsl.exe' } : {}),
        ...(!startupPlan.startupCommandDelivery
          ? {}
          : { startupCommandDelivery: startupPlan.startupCommandDelivery }),
        env: paneEnv,
        launchConfig: startupPlan.launchConfig,
        launchToken,
        launchAgent: agent,
        connectionId: sshConnectionId,
        worktreeId,
        tabId: reservedTabId,
        leafId,
        telemetry: {
          agent_kind: tuiAgentToAgentKind(agent),
          launch_source: launchSource ?? 'unknown',
          request_kind: 'new'
        }
      })
      ptyId = result.id
      startupMutationAccess = result.administrativeMutationAccess ?? { mode: 'legacy' }
      returnedLaunchConfig = result.launchConfig
    }
    const adopted = await adoptAgentBackgroundSessionTab({
      store,
      worktreeId,
      reservedTabId,
      ptyId,
      paneKey,
      launchConfig: returnedLaunchConfig ?? startupPlan.launchConfig,
      launchRegistration,
      runtimeTarget,
      runtimeTerminalHandle,
      onRetire: () => {
        exitHandled = true
        sshStartupDelivery.clear()
        store.clearAgentLaunchConfig(paneKey)
      },
      ...(title ? { title } : {})
    })
    if (!adopted) {
      return null
    }
    tab = adopted.tab
    paneKey = adopted.paneKey
    terminalOwnership = adopted.terminalOwnership
    if (agent === 'command-code' && hasPrompt && !isFollowupPath) {
      // Why: Command Code does not expose a prompt-start hook; seed working for
      // hidden prompt launches so sidebar/activity surfaces do not stay idle.
      const routing = agentStatusConsumer.resolveRouting()
      if (routing) {
        store.setAgentStatus(
          paneKey,
          { state: 'working', prompt: trimmedPrompt, agentType: agent },
          undefined,
          undefined,
          routing,
          { launchConfig: startupPlan.launchConfig, launchToken }
        )
      }
    }

    if (runtimeTarget.kind === 'environment') {
      if (!runtimeTerminalHandle) {
        throw new Error('Runtime terminal id is invalid.')
      }
      unsubscribeData = await subscribeToRuntimeTerminalData(
        store.settings,
        ptyId,
        `desktop:background:${tab.id}`,
        handleData
      )
      void callRuntimeRpc<{ wait: { exitCode?: number | null } }>(
        runtimeTarget,
        'terminal.wait',
        { terminal: runtimeTerminalHandle, for: 'exit' },
        { timeoutMs: 24 * 60 * 60 * 1000 }
      )
        .then((result) => handleExit(ptyId, result.wait.exitCode ?? 0))
        .catch(() => {})
    } else {
      eagerPtyBuffer = registerEagerPtyBuffer(ptyId, handleExit)
      unsubscribeData = subscribeToPtyData(ptyId, handleData)
      // Why: opening the workspace attaches a real terminal transport and disposes
      // the eager exit handler. This sidecar keeps automation completion tracking
      // alive regardless of whether the tab is hidden or mounted.
      unsubscribeExit = subscribeToPtyExit(ptyId, (code) => handleExit(ptyId, code))
    }
    sshStartupDelivery.armFallback(ptyId)

    // Why: bind the explicit PTY and ownership before mount; an earlier mount
    // can double-spawn, while later tracking can miss user takeover.
    requestBackgroundTerminalWorktreeMount({ worktreeId, tabIds: [tab.id] })

    if (pasteDraftAfterLaunch !== null) {
      scheduleAgentBackgroundDraft(tab.id, pasteDraftAfterLaunch, agent)
    }

    return { tabId: tab.id, paneKey, ptyId, startupPlan, terminalOwnership }
  } catch (error) {
    // Why: terminal creation and stream subscription are separate remote calls.
    // A failure between them must not strand an invisible runtime terminal.
    exitHandled = true
    const createdTab = tab
    await cleanupFailedAgentBackgroundSession({
      releaseTerminalOwnership: () => terminalOwnership?.release(),
      unsubscribeExit,
      unsubscribeData,
      disposeEagerPtyBuffer: () => eagerPtyBuffer?.dispose(),
      clearStartupDelivery: () => sshStartupDelivery.clear(),
      clearAgentLaunchConfig: () => store.clearAgentLaunchConfig(paneKey),
      ...(createdTab
        ? {
            clearTabPtyId: () => store.clearTabPtyId(createdTab.id, ptyId),
            closeCreatedTab: () =>
              // Cleanup closes must not enter the reopen stack.
              store.closeTab(createdTab.id, { recordInteraction: false, reason: 'cleanup' })
          }
        : {}),
      retireProvider: () =>
        ptyId ? retireProvider({ ptyId, runtimeTarget, runtimeTerminalHandle }) : Promise.resolve()
    })
    throw error
  }
}
