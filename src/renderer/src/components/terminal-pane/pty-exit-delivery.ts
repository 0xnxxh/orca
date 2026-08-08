import {
  bufferPreHandlerPtyExit,
  clearPreHandlerPtyState,
  consumePreHandlerPtyState
} from './pty-pre-handler-buffer'
import {
  isEventKeyedPtyExitHandler,
  onPtyExitHandlerAvailable,
  ptyExitHandlers,
  type PtyExitHandler
} from './pty-shutdown-data-suspension'
import type {
  TerminalAuthorityAppOutcomeIdentity,
  TerminalAuthorityOutcomeProjectionKind
} from '@/lib/terminal-authority-app-projection-controller'

export type PtyExitSidecar = (
  code: number,
  context: {
    hadPrimary: boolean
    incarnationId?: string
    authorityOutcome?: TerminalAuthorityAppOutcomeIdentity
  }
) => unknown

export type PtyExitHandlerSnapshot = Readonly<{
  primary?: PtyExitHandler
  sidecars: readonly PtyExitSidecar[]
}>

const ptyExitSidecars = new Map<string, Set<PtyExitSidecar>>()
const ptyExitSidecarAvailableListeners = new Set<() => void>()
const eventKeyedPtyExitSidecars = new WeakSet<PtyExitSidecar>()

export type PtyExitDelivery = {
  ptyId: string
  code: number
  incarnationId?: string
  authorityOutcome?: TerminalAuthorityAppOutcomeIdentity
  primary?: PtyExitHandler
  sidecars: readonly PtyExitSidecar[]
}

export function snapshotPtyExitHandlers(ptyId: string): PtyExitHandlerSnapshot {
  return {
    ...(ptyExitHandlers.get(ptyId) ? { primary: ptyExitHandlers.get(ptyId) } : {}),
    sidecars: Array.from(ptyExitSidecars.get(ptyId) ?? [])
  }
}

export function takePtyExitHandlers(ptyId: string): PtyExitHandlerSnapshot {
  const snapshot = snapshotPtyExitHandlers(ptyId)
  ptyExitSidecars.delete(ptyId)
  if (snapshot.primary && ptyExitHandlers.get(ptyId) === snapshot.primary) {
    ptyExitHandlers.delete(ptyId)
  }
  return snapshot
}

export function releasePtyExitHandlers(ptyId: string, snapshot: PtyExitHandlerSnapshot): void {
  if (snapshot.primary && ptyExitHandlers.get(ptyId) === snapshot.primary) {
    ptyExitHandlers.delete(ptyId)
  }
  const currentSidecars = ptyExitSidecars.get(ptyId)
  if (!currentSidecars) {
    return
  }
  for (const sidecar of snapshot.sidecars) {
    currentSidecars.delete(sidecar)
  }
  if (currentSidecars.size === 0) {
    ptyExitSidecars.delete(ptyId)
  }
}

export function isEventKeyedPtyExitSnapshot(snapshot: PtyExitHandlerSnapshot): boolean {
  return (
    (!snapshot.primary || isEventKeyedPtyExitHandler(snapshot.primary)) &&
    snapshot.sidecars.every((sidecar) => eventKeyedPtyExitSidecars.has(sidecar))
  )
}

export function registerPtyExitSidecar(
  ptyId: string,
  sidecar: PtyExitSidecar,
  projection?: TerminalAuthorityOutcomeProjectionKind
): () => void {
  let sidecars = ptyExitSidecars.get(ptyId)
  if (!sidecars) {
    sidecars = new Set()
    ptyExitSidecars.set(ptyId, sidecars)
  }
  if (projection === 'event-keyed-idempotent') {
    eventKeyedPtyExitSidecars.add(sidecar)
  }
  sidecars.add(sidecar)
  for (const listener of ptyExitSidecarAvailableListeners) {
    listener()
  }
  return () => {
    const current = ptyExitSidecars.get(ptyId)
    current?.delete(sidecar)
    if (current?.size === 0) {
      ptyExitSidecars.delete(ptyId)
    }
  }
}

export function onPtyExitPolicyAvailable(listener: () => void): () => void {
  const stopPrimary = onPtyExitHandlerAvailable(listener)
  ptyExitSidecarAvailableListeners.add(listener)
  return () => {
    stopPrimary()
    ptyExitSidecarAvailableListeners.delete(listener)
  }
}

/** Delivers one exit to its primary owner and every observational sidecar. */
export function deliverPtyExitToHandlers(delivery: PtyExitDelivery): void {
  let firstError: unknown
  let hasError = false
  try {
    if (delivery.primary) {
      clearPreHandlerPtyState(delivery.ptyId)
      try {
        if (delivery.incarnationId) {
          delivery.primary(delivery.code, delivery.incarnationId, delivery.authorityOutcome)
        } else {
          delivery.primary(delivery.code, undefined, delivery.authorityOutcome)
        }
      } finally {
        // Why: ownership is final even when cleanup throws; a duplicate exit
        // must not become a new pre-handler event for a future mount.
        consumePreHandlerPtyState(delivery.ptyId)
      }
    } else {
      bufferPreHandlerPtyExit(delivery.ptyId, delivery.code, delivery.incarnationId)
    }
  } catch (error) {
    firstError = error
    hasError = true
  }

  for (const sidecar of delivery.sidecars) {
    try {
      sidecar(delivery.code, {
        hadPrimary: delivery.primary !== undefined,
        ...(delivery.incarnationId ? { incarnationId: delivery.incarnationId } : {}),
        ...(delivery.authorityOutcome ? { authorityOutcome: delivery.authorityOutcome } : {})
      })
    } catch (error) {
      if (!hasError) {
        firstError = error
        hasError = true
      }
    }
  }
  if (hasError) {
    throw firstError
  }
}

export async function settleAuthoritativePtyExitHandlers(delivery: PtyExitDelivery): Promise<void> {
  let firstError: unknown
  if (delivery.primary) {
    clearPreHandlerPtyState(delivery.ptyId)
    try {
      await delivery.primary(delivery.code, delivery.incarnationId, delivery.authorityOutcome)
    } catch (error) {
      firstError = error
    } finally {
      consumePreHandlerPtyState(delivery.ptyId)
    }
  }
  for (const sidecar of delivery.sidecars) {
    try {
      await sidecar(delivery.code, {
        hadPrimary: delivery.primary !== undefined,
        ...(delivery.incarnationId ? { incarnationId: delivery.incarnationId } : {}),
        ...(delivery.authorityOutcome ? { authorityOutcome: delivery.authorityOutcome } : {})
      })
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) {
    throw firstError
  }
}
