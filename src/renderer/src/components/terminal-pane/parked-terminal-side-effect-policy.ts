import { isClaudeAgent } from '../../../../shared/agent-detection'
import { useAppStore } from '@/store'
import {
  AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS,
  isAgentTaskCompleteOsNotificationEnabledFromState,
  isAgentTaskCompleteTrackingEnabledFromState
} from './agent-task-complete-policy'
import { dispatchTerminalNotification } from './use-notification-dispatch'

type ParkedTerminalSideEffectPolicyOptions = {
  tabId: string
  worktreeId: string
  paneId: number
  paneKey: string
  drivesTabTitle: boolean
}

export type ParkedTerminalSideEffectPolicy = {
  callbacks: {
    onTitleChange: (title: string) => void
    onBell: () => void
    onAgentBecameIdle: (title: string, meta?: { staleWorkingTitleClear?: boolean }) => void
    onAgentBecameWorking: () => void
    onAgentExited: () => void
  }
  dispose: (options?: { preserveRuntimeTitle?: boolean }) => void
}

export function createParkedTerminalSideEffectPolicy(
  options: ParkedTerminalSideEffectPolicyOptions
): ParkedTerminalSideEffectPolicy {
  let disposed = false
  let pendingBellNotification = false
  let wroteRuntimeTitleSlot = false
  let bellNotificationTimer: ReturnType<typeof setTimeout> | null = null
  let agentTaskCompleteTimer: ReturnType<typeof setTimeout> | null = null

  const clearBellNotificationTimer = (): void => {
    if (bellNotificationTimer !== null) {
      clearTimeout(bellNotificationTimer)
      bellNotificationTimer = null
    }
  }
  const clearAgentTaskCompleteTimer = (): void => {
    if (agentTaskCompleteTimer !== null) {
      clearTimeout(agentTaskCompleteTimer)
      agentTaskCompleteTimer = null
    }
  }
  const hasPendingAgentTaskCompleteNotification = (): boolean =>
    agentTaskCompleteTimer !== null &&
    isAgentTaskCompleteOsNotificationEnabledFromState(useAppStore.getState())
  const scheduleTerminalBellNotification = (): void => {
    if (bellNotificationTimer !== null) {
      return
    }
    bellNotificationTimer = setTimeout(() => {
      bellNotificationTimer = null
      if (disposed) {
        pendingBellNotification = false
        return
      }
      if (hasPendingAgentTaskCompleteNotification()) {
        return
      }
      pendingBellNotification = false
      dispatchTerminalNotification(options.worktreeId, {
        source: 'terminal-bell',
        paneKey: options.paneKey
      })
    }, AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS)
  }

  return {
    callbacks: {
      onTitleChange(title): void {
        const state = useAppStore.getState()
        wroteRuntimeTitleSlot = true
        state.setRuntimePaneTitle(options.tabId, options.paneId, title)
        if (options.drivesTabTitle) {
          state.updateTabTitle(options.tabId, title)
        }
      },
      onBell(): void {
        const state = useAppStore.getState()
        state.markWorktreeUnread(options.worktreeId)
        state.markTerminalTabUnread(options.tabId)
        if (state.settings?.experimentalTerminalAttention === true) {
          state.markTerminalPaneUnread(options.paneKey)
        }
        pendingBellNotification = true
        if (!hasPendingAgentTaskCompleteNotification()) {
          scheduleTerminalBellNotification()
        }
      },
      onAgentBecameIdle(title, meta): void {
        if (meta?.staleWorkingTitleClear) {
          useAppStore.getState().setCacheTimerStartedAt(options.paneKey, null)
          return
        }
        const state = useAppStore.getState()
        if (
          isClaudeAgent(title) &&
          (state.settings === null || state.settings.promptCacheTimerEnabled)
        ) {
          state.setCacheTimerStartedAt(options.paneKey, Date.now())
        }
        if (!isAgentTaskCompleteTrackingEnabledFromState(state)) {
          return
        }
        clearAgentTaskCompleteTimer()
        agentTaskCompleteTimer = setTimeout(() => {
          agentTaskCompleteTimer = null
          if (disposed) {
            return
          }
          pendingBellNotification = false
          clearBellNotificationTimer()
          dispatchTerminalNotification(options.worktreeId, {
            source: 'agent-task-complete',
            terminalTitle: title,
            paneKey: options.paneKey,
            ...(isAgentTaskCompleteOsNotificationEnabledFromState(useAppStore.getState())
              ? {}
              : { suppressOsNotification: true })
          })
        }, AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS)
      },
      onAgentBecameWorking(): void {
        useAppStore.getState().setCacheTimerStartedAt(options.paneKey, null)
        clearAgentTaskCompleteTimer()
        if (pendingBellNotification) {
          scheduleTerminalBellNotification()
        }
      },
      onAgentExited(): void {
        useAppStore.getState().setCacheTimerStartedAt(options.paneKey, null)
      }
    },
    dispose(disposeOptions): void {
      if (disposed) {
        return
      }
      disposed = true
      clearBellNotificationTimer()
      clearAgentTaskCompleteTimer()
      pendingBellNotification = false
      if (wroteRuntimeTitleSlot && disposeOptions?.preserveRuntimeTitle !== true) {
        wroteRuntimeTitleSlot = false
        useAppStore.getState().clearRuntimePaneTitle(options.tabId, options.paneId)
      }
    }
  }
}
