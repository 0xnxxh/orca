import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON } from '../../../../shared/pty-shutdown-safety'
import {
  buildTerminalTabRetirementPlan,
  type TerminalTabRetirementPlan,
  type TerminalTabRetirementState
} from './terminal-tab-retirement'

const pendingPreflights = new Set<string>()

function getShutdownSafetyPreflight():
  | ((id: string) => ReturnType<Window['api']['pty']['getShutdownBlockReason']>)
  | undefined {
  return (globalThis.window?.api?.pty as Partial<Window['api']['pty']> | undefined)
    ?.getShutdownBlockReason
}

export function hasTerminalShutdownSafetyPreflight(): boolean {
  return typeof getShutdownSafetyPreflight() === 'function'
}

function surfaceBlockedShutdown(surfaceId: string): void {
  toast.error(
    translate(
      'auto.store.slices.terminal.shutdown.safety.5a57c04372',
      'Terminal kept open for safety'
    ),
    {
      id: `terminal-shutdown-safety-${surfaceId}`,
      description: translate(
        'auto.store.slices.terminal.shutdown.safety.8a31e30a75',
        'This older Windows session cannot be stopped safely by Orca. Exit the agent or shell in this terminal. If it stays running, end its process tree in Task Manager or restart Windows.'
      ),
      duration: 15_000
    }
  )
}

function surfacePreflightFailure(surfaceId: string): void {
  toast.error(
    translate(
      'auto.store.slices.terminal.shutdown.safety.d929a6767b',
      'Terminal kept open because shutdown could not be verified'
    ),
    {
      id: `terminal-shutdown-safety-${surfaceId}`,
      description: translate(
        'auto.store.slices.terminal.shutdown.safety.44c3706121',
        'Retry closing the terminal. Orca kept the tab and its process ownership intact.'
      ),
      duration: 15_000
    }
  )
}

export async function assertTerminalShutdownSafety(args: {
  surfaceId: string
  ptyIds: string[]
}): Promise<void> {
  const getShutdownBlockReason = getShutdownSafetyPreflight()
  if (!getShutdownBlockReason || args.ptyIds.length === 0) {
    return
  }

  let reasons: Awaited<ReturnType<typeof getShutdownBlockReason>>[]
  try {
    reasons = await Promise.all(args.ptyIds.map((ptyId) => getShutdownBlockReason(ptyId)))
  } catch (error) {
    // Why: an unavailable ownership inventory is not permission to hide a live session.
    console.warn('[terminal-retirement] shutdown safety preflight failed', {
      surfaceId: args.surfaceId,
      error
    })
    surfacePreflightFailure(args.surfaceId)
    throw error
  }

  if (reasons.includes(WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON)) {
    surfaceBlockedShutdown(args.surfaceId)
    throw new Error(WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON)
  }
}

export function deferTerminalCloseForShutdownSafety(args: {
  tabId: string
  ptyIds: string[]
  onAllowed: () => void
  onBlocked?: () => void
}): boolean {
  if (!hasTerminalShutdownSafetyPreflight() || args.ptyIds.length === 0) {
    return false
  }
  if (pendingPreflights.has(args.tabId)) {
    return true
  }

  pendingPreflights.add(args.tabId)
  void assertTerminalShutdownSafety({ surfaceId: args.tabId, ptyIds: args.ptyIds }).then(
    () => {
      pendingPreflights.delete(args.tabId)
      args.onAllowed()
    },
    () => {
      pendingPreflights.delete(args.tabId)
      args.onBlocked?.()
    }
  )
  return true
}

export function deferTerminalTabCloseForShutdownSafety(args: {
  state: TerminalTabRetirementState
  tabId: string
  precomputedRetirementPlan?: TerminalTabRetirementPlan
  onAllowed: (plan: TerminalTabRetirementPlan) => void
  onBlocked?: () => void
}): boolean {
  if (!hasTerminalShutdownSafetyPreflight()) {
    return false
  }
  const plan =
    args.precomputedRetirementPlan?.tabId === args.tabId
      ? args.precomputedRetirementPlan
      : buildTerminalTabRetirementPlan(args.state, args.tabId)
  return deferTerminalCloseForShutdownSafety({
    tabId: args.tabId,
    ptyIds: plan.localOrSshPtyIds,
    onAllowed: () => args.onAllowed(plan),
    ...(args.onBlocked ? { onBlocked: args.onBlocked } : {})
  })
}
