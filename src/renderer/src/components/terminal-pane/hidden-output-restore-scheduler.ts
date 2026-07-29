type HiddenOutputRestorePriority = 'active' | 'inactive'

type HiddenOutputRestoreRequest = () => void | Promise<void>

type HiddenOutputRestoreEntry = {
  requestRestore: HiddenOutputRestoreRequest
}

// Why: one inactive xterm scrollback replay per frame keeps tab return focused
// on the active pane while still catching watched split panes up quickly.
const INACTIVE_RESTORE_INTERVAL_MS = 16

const inactiveRestoreQueue = new Map<object, HiddenOutputRestoreEntry>()
// Why: overlapping deep replays can starve the active pane the user is returning to.
const activeRestoreTokensByTarget = new Map<object, object>()
let inactiveRestoreTimer: ReturnType<typeof setTimeout> | null = null

function clearInactiveRestoreTimer(): void {
  if (inactiveRestoreTimer === null) {
    return
  }
  clearTimeout(inactiveRestoreTimer)
  inactiveRestoreTimer = null
}

function scheduleInactiveRestoreDrain(): void {
  if (
    inactiveRestoreTimer !== null ||
    activeRestoreTokensByTarget.size > 0 ||
    inactiveRestoreQueue.size === 0
  ) {
    return
  }
  inactiveRestoreTimer = setTimeout(drainInactiveRestoreQueue, INACTIVE_RESTORE_INTERVAL_MS)
}

function finishActiveRestore(target: object, token: object): void {
  if (activeRestoreTokensByTarget.get(target) !== token) {
    return
  }
  activeRestoreTokensByTarget.delete(target)
  scheduleInactiveRestoreDrain()
}

function runActiveRestore(target: object, requestRestore: HiddenOutputRestoreRequest): void {
  const token = {}
  activeRestoreTokensByTarget.set(target, token)
  try {
    const completion = requestRestore()
    if (completion) {
      void completion.then(
        () => finishActiveRestore(target, token),
        () => finishActiveRestore(target, token)
      )
      return
    }
  } catch (error) {
    finishActiveRestore(target, token)
    throw error
  }
  finishActiveRestore(target, token)
}

function drainInactiveRestoreQueue(): void {
  inactiveRestoreTimer = null
  if (activeRestoreTokensByTarget.size > 0) {
    return
  }
  const next = inactiveRestoreQueue.entries().next()
  if (next.done) {
    return
  }
  const [target, entry] = next.value
  inactiveRestoreQueue.delete(target)
  entry.requestRestore()
  scheduleInactiveRestoreDrain()
}

export function scheduleHiddenOutputRestore(
  target: object,
  requestRestore: HiddenOutputRestoreRequest,
  priority: HiddenOutputRestorePriority
): void {
  if (priority === 'active') {
    cancelScheduledHiddenOutputRestore(target)
    runActiveRestore(target, requestRestore)
    return
  }
  inactiveRestoreQueue.set(target, { requestRestore })
  scheduleInactiveRestoreDrain()
}

export function cancelScheduledHiddenOutputRestore(target: object): void {
  inactiveRestoreQueue.delete(target)
  const activeToken = activeRestoreTokensByTarget.get(target)
  if (activeToken) {
    finishActiveRestore(target, activeToken)
  }
  if (inactiveRestoreQueue.size === 0) {
    clearInactiveRestoreTimer()
  }
}

export function resetHiddenOutputRestoreSchedulerForTests(): void {
  activeRestoreTokensByTarget.clear()
  inactiveRestoreQueue.clear()
  clearInactiveRestoreTimer()
}
