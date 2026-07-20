import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { WINDOWS_LEGACY_PTY_SHUTDOWN_BLOCK_REASON } from '../../../../shared/pty-shutdown-safety'
import {
  buildTerminalTabRetirementPlan,
  buildTerminalTabRetirementPlans,
  type TerminalTabRetirementPlan,
  type TerminalTabRetirementState
} from './terminal-tab-retirement'

const pendingPreflights = new Set<string>()
const MAX_STABILITY_ATTEMPTS = 3

type StableTerminalShutdownPlan = {
  plans: Map<string, TerminalTabRetirementPlan>
  signature: string
}

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

function buildStableTerminalShutdownPlan(
  state: TerminalTabRetirementState,
  tabIds: readonly string[]
): StableTerminalShutdownPlan {
  const plans = buildTerminalTabRetirementPlans(state, tabIds)
  const signature = JSON.stringify(
    [...plans.values()].map((plan) => ({
      tabId: plan.tabId,
      worktreeId: plan.worktreeId,
      localOrSshPtyIds: [...plan.localOrSshPtyIds].sort(),
      runtimePtyIds: plan.runtimeTerminals.map((terminal) => terminal.ptyId).sort(),
      sharedPtyIds: [...plan.sharedPtyIds].sort(),
      cleanupOnlyPtyIds: [...plan.cleanupOnlyPtyIds].sort(),
      unroutablePtyIds: [...plan.unroutablePtyIds].sort()
    }))
  )
  return { plans, signature }
}

function getLocalOrSshPtyIds(plans: ReadonlyMap<string, TerminalTabRetirementPlan>): string[] {
  return [...new Set([...plans.values()].flatMap((plan) => plan.localOrSshPtyIds))]
}

/**
 * Rechecks renderer ownership after async main-process inventory. The returned
 * plans are safe to consume synchronously in the same renderer turn.
 */
export async function assertStableTerminalShutdownSafety(args: {
  surfaceId: string
  getState: () => TerminalTabRetirementState
  selectTabIds: (state: TerminalTabRetirementState) => readonly string[]
}): Promise<Map<string, TerminalTabRetirementPlan>> {
  for (let attempt = 0; attempt < MAX_STABILITY_ATTEMPTS; attempt += 1) {
    const beforeState = args.getState()
    const before = buildStableTerminalShutdownPlan(beforeState, args.selectTabIds(beforeState))
    await assertTerminalShutdownSafety({
      surfaceId: args.surfaceId,
      ptyIds: getLocalOrSshPtyIds(before.plans)
    })
    const currentState = args.getState()
    const after = buildStableTerminalShutdownPlan(currentState, args.selectTabIds(currentState))
    if (before.signature === after.signature) {
      return after.plans
    }
  }

  // Why: repeated ownership churn means no asynchronous answer still describes
  // the tab state; fail closed instead of retiring a newly attached PTY.
  surfacePreflightFailure(args.surfaceId)
  throw new Error('Terminal ownership changed while shutdown safety was being verified')
}

export function selectTerminalTabIdsForWorktrees(
  state: TerminalTabRetirementState,
  worktreeIds: ReadonlySet<string>
): string[] {
  const tabIds = new Set<string>()
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    if (!worktreeIds.has(worktreeId)) {
      continue
    }
    for (const tab of tabs) {
      tabIds.add(tab.id)
    }
  }
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree)) {
    if (!worktreeIds.has(worktreeId)) {
      continue
    }
    for (const tab of tabs) {
      if (tab.contentType === 'terminal') {
        tabIds.add(tab.entityId)
      }
    }
  }
  return [...tabIds]
}

export function deferTerminalTabCloseForShutdownSafety(args: {
  getState: () => TerminalTabRetirementState
  tabId: string
  onAllowed: (plan: TerminalTabRetirementPlan) => void
  onBlocked?: () => void
}): boolean {
  if (!hasTerminalShutdownSafetyPreflight()) {
    return false
  }
  const initialPlan = buildTerminalTabRetirementPlan(args.getState(), args.tabId)
  if (initialPlan.localOrSshPtyIds.length === 0) {
    return false
  }
  if (pendingPreflights.has(args.tabId)) {
    return true
  }

  pendingPreflights.add(args.tabId)
  void assertStableTerminalShutdownSafety({
    surfaceId: args.tabId,
    getState: args.getState,
    selectTabIds: () => [args.tabId]
  }).then(
    (plans) => {
      pendingPreflights.delete(args.tabId)
      args.onAllowed(
        plans.get(args.tabId) ?? buildTerminalTabRetirementPlan(args.getState(), args.tabId)
      )
    },
    () => {
      pendingPreflights.delete(args.tabId)
      args.onBlocked?.()
    }
  )
  return true
}
