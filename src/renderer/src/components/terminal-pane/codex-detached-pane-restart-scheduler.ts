import { useAppStore } from '@/store'
import {
  resetDetachedCodexPaneRestartClaimsForTests,
  sweepUnclaimedCodexPaneRestarts
} from './codex-detached-pane-restart'

let executorInstalled = false
let executorGeneration = 0
let sweepQueued = false
let sweepRunning = false
let sweepRequestedAfterRun = false

/** Installed once at app startup; returns the uninstaller (tests). */
export function installCodexDetachedPaneRestartExecutor(): () => void {
  executorInstalled = true
  const generation = ++executorGeneration
  const unsubscribe = useAppStore.subscribe((state, previousState) => {
    const addedPendingId = Object.keys(state.pendingCodexPaneRestartIds).some(
      (ptyId) => !previousState.pendingCodexPaneRestartIds[ptyId]
    )
    if (addedPendingId) {
      scheduleClaimSweep()
    }
  })
  scheduleClaimSweep()
  return () => {
    unsubscribe()
    if (executorGeneration === generation) {
      executorInstalled = false
      executorGeneration += 1
      sweepQueued = false
      sweepRequestedAfterRun = false
    }
  }
}

export function resetCodexDetachedPaneRestartExecutorForTests(): void {
  executorInstalled = false
  executorGeneration += 1
  sweepQueued = false
  sweepRunning = false
  sweepRequestedAfterRun = false
  resetDetachedCodexPaneRestartClaimsForTests()
}

function scheduleClaimSweep(): void {
  if (!executorInstalled) {
    return
  }
  if (sweepRunning) {
    sweepRequestedAfterRun = true
    return
  }
  if (sweepQueued) {
    return
  }
  sweepQueued = true
  const generation = executorGeneration
  // Exact mounted-owner checks fence the claim; a microtask only exits the store write.
  queueMicrotask(() => {
    sweepQueued = false
    if (!executorInstalled || executorGeneration !== generation) {
      return
    }
    sweepRunning = true
    void sweepUnclaimedCodexPaneRestarts().finally(() => {
      sweepRunning = false
      if (executorInstalled && sweepRequestedAfterRun) {
        sweepRequestedAfterRun = false
        scheduleClaimSweep()
      }
    })
  })
}
