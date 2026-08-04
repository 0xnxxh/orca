import { useCallback, useSyncExternalStore } from 'react'

// Why: the store status lags a user click by one IPC hop (main broadcasts 'connecting'
// after ssh.connect starts), and every workspace card on a host shares one connection.
// Component-local state would let two surfaces — or N cards on the same host — each fire
// a connect, which on a passphrase-gated target means N credential prompts.
const inFlightTargetIds = new Set<string>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeSshConnectInFlight(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function beginSshConnect(targetId: string): void {
  if (inFlightTargetIds.has(targetId)) {
    return
  }
  inFlightTargetIds.add(targetId)
  emit()
}

export function endSshConnect(targetId: string): void {
  if (!inFlightTargetIds.delete(targetId)) {
    return
  }
  emit()
}

export function isSshConnectInFlight(targetId: string): boolean {
  return inFlightTargetIds.has(targetId)
}

export function useSshConnectInFlight(targetId: string): boolean {
  const getSnapshot = useCallback(() => inFlightTargetIds.has(targetId), [targetId])
  return useSyncExternalStore(subscribeSshConnectInFlight, getSnapshot, getSnapshot)
}

/** Test-only: the registry is module state, so specs must reset it between cases. */
export function resetSshConnectInFlightForTests(): void {
  inFlightTargetIds.clear()
  emit()
}
