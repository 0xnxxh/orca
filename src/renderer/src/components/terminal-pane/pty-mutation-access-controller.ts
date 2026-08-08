import type {
  PtyMutationAccess,
  PtyMutationClaimant,
  PtyMutationIdentity
} from '../../../../shared/pty-mutation-identity'
import {
  createPtyMutationAccessClaim,
  normalizePtyMutationAccess
} from './pty-mutation-access-claim'
import { killPtyWithMutationIdentity, type PendingPtyMutation } from './pty-mutation-operation'
import { mintPtyMutationClaimant } from './pty-mutation-claimant'
import type { PtyMutationBindingTarget } from './pty-mutation-binding-target'
import { dispatchPtyMutationOperation } from './pty-mutation-operation-dispatch'

export const PTY_MUTATION_PENDING_OPERATION_LIMIT = 4_096

export type PtyMutationAccessController = ReturnType<typeof createPtyMutationAccessController>

export function createPtyMutationAccessController(options: {
  tabId?: string
  leafId?: string
  paneGeneration?: number
  onUnavailable?: (error: Error) => void
  onAccessAvailable?: (id: string) => void
}) {
  let boundId: string | null = null
  let bindingRevision = 0
  let bindingTarget: PtyMutationBindingTarget | null = null
  let access: PtyMutationAccess = { mode: 'unavailable' }
  let pending: PendingPtyMutation[] = []
  let pendingIndex = 0
  let flushing = false
  let terminalError: Error | null = null
  let preparedClaimant: PtyMutationClaimant | null = null
  const accessClaim = createPtyMutationAccessClaim(options)

  const mutationIdentity = (): PtyMutationIdentity | undefined =>
    access.mode === 'exact' ? access.identity : undefined
  const hasMutationAccess = (): boolean => access.mode !== 'unavailable'
  const isCurrentBinding = (id: string, revision: number): boolean =>
    id === boundId && revision === bindingRevision && terminalError === null
  const refreshBindingTarget = (): void => {
    bindingTarget =
      boundId && access.mode !== 'unavailable'
        ? Object.freeze({ id: boundId, bindingRevision, access })
        : null
  }
  const captureTarget = (id: string): PtyMutationBindingTarget | null =>
    bindingTarget?.id === id && isCurrentBinding(id, bindingTarget.bindingRevision)
      ? bindingTarget
      : null
  const isCurrentTarget = (target: PtyMutationBindingTarget): boolean =>
    isCurrentBinding(target.id, target.bindingRevision) && access.mode !== 'unavailable'

  const settleOperation = (operation: PendingPtyMutation, error: Error): void => {
    if (operation.kind === 'write-accepted') {
      operation.resolve(false)
    } else if (operation.kind === 'kill') {
      operation.reject(error)
    }
  }

  const settlePending = (error: Error): void => {
    for (let index = pendingIndex; index < pending.length; index += 1) {
      const operation = pending[index]
      if (!operation) {
        continue
      }
      if (operation.kind === 'write-accepted') {
        operation.resolve(false)
      } else if (operation.kind === 'kill') {
        operation.reject(error)
      }
    }
    pending = []
    pendingIndex = 0
  }

  const fail = (error: Error): void => {
    if (terminalError) {
      return
    }
    terminalError = error
    bindingTarget = null
    accessClaim.cancel()
    settlePending(error)
    options.onUnavailable?.(error)
  }

  const dispatch = async (operation: PendingPtyMutation): Promise<void> => {
    if (
      !isCurrentBinding(operation.id, operation.bindingRevision) ||
      access.mode === 'unavailable'
    ) {
      if (operation.kind === 'write-accepted') {
        operation.resolve(false)
      } else if (operation.kind === 'kill') {
        operation.reject(new Error('pty_mutation_access_released'))
      }
      return
    }
    await dispatchPtyMutationOperation(operation, access, () =>
      isCurrentBinding(operation.id, operation.bindingRevision)
    )
  }

  const flush = async (): Promise<void> => {
    if (flushing || access.mode === 'unavailable' || terminalError) {
      return
    }
    flushing = true
    try {
      while (pendingIndex < pending.length && hasMutationAccess() && !terminalError) {
        const operation = pending[pendingIndex]
        if (operation) {
          pendingIndex += 1
          try {
            await dispatch(operation)
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        }
      }
    } finally {
      if (pendingIndex === pending.length) {
        pending = []
        pendingIndex = 0
      }
      flushing = false
    }
  }

  const enqueue = (operation: PendingPtyMutation): boolean => {
    if (!isCurrentBinding(operation.id, operation.bindingRevision)) {
      settleOperation(operation, new Error('pty_mutation_access_released'))
      return false
    }
    if (terminalError) {
      settleOperation(operation, terminalError)
      return false
    }
    if (access.mode === 'unavailable' || flushing) {
      if (pending.length - pendingIndex >= PTY_MUTATION_PENDING_OPERATION_LIMIT) {
        const error = new Error('pty_mutation_access_queue_overflow')
        settleOperation(operation, error)
        return false
      }
      pending.push(operation)
      return true
    }
    void dispatch(operation).catch((error) =>
      fail(error instanceof Error ? error : new Error(String(error)))
    )
    return true
  }

  return {
    prepareBinding(): PtyMutationClaimant {
      preparedClaimant = mintPtyMutationClaimant()
      return preparedClaimant
    },
    bind(
      id: string,
      initialAccess?: PtyMutationAccess,
      suppliedClaimant?: PtyMutationClaimant
    ): void {
      bindingRevision += 1
      accessClaim.cancel()
      settlePending(new Error('pty_mutation_access_released'))
      boundId = id
      const claimant =
        options.paneGeneration !== undefined
          ? (suppliedClaimant ?? preparedClaimant ?? mintPtyMutationClaimant())
          : undefined
      preparedClaimant = null
      access = normalizePtyMutationAccess(
        initialAccess ??
          (options.paneGeneration === undefined ? { mode: 'legacy' } : { mode: 'unavailable' }),
        options.paneGeneration,
        claimant
      )
      terminalError = null
      refreshBindingTarget()
      if (access.mode === 'unavailable') {
        accessClaim.start(id, claimant!, {
          onClaimed: (claimed) => {
            if (boundId !== id || terminalError) {
              return
            }
            access = claimed
            refreshBindingTarget()
            options.onAccessAvailable?.(id)
            void flush()
          },
          onUnavailable: fail
        })
      } else {
        options.onAccessAvailable?.(id)
      }
    },
    canMutate: (id) => id === boundId && hasMutationAccess() && !flushing && terminalError === null,
    hasAccess: (id) => id === boundId && hasMutationAccess() && terminalError === null,
    captureTarget,
    isCurrentTarget,
    currentIdentity: (id) =>
      id === boundId && access.mode === 'exact' ? access.identity : undefined,
    isLegacyBinding: (id) => id === boundId && access.mode === 'legacy',
    write(id, data): boolean {
      const target = captureTarget(id)
      if (target && !flushing) {
        if (target.access.mode === 'exact') {
          window.api.pty.write(id, data, target.access.identity)
        } else {
          window.api.pty.write(id, data)
        }
        return true
      }
      return false
    },
    writeTarget(target: PtyMutationBindingTarget, data: string): boolean {
      if (!isCurrentTarget(target) || flushing) {
        return false
      }
      if (target.access.mode === 'exact') {
        window.api.pty.write(target.id, data, target.access.identity)
      } else {
        window.api.pty.write(target.id, data)
      }
      return true
    },
    writeAccepted: (id, data) => {
      if (id !== boundId || !hasMutationAccess() || flushing || terminalError) {
        return Promise.resolve(false)
      }
      return new Promise<boolean>((resolve) =>
        enqueue({ kind: 'write-accepted', id, bindingRevision, data, resolve })
      )
    },
    writeAcceptedTarget: (target: PtyMutationBindingTarget, data: string) => {
      if (!isCurrentTarget(target) || flushing) {
        return Promise.resolve(false)
      }
      const request =
        target.access.mode === 'exact'
          ? window.api.pty.writeAccepted(target.id, data, target.access.identity)
          : window.api.pty.writeAccepted(target.id, data)
      return Promise.resolve(request)
        .then((accepted) => accepted && isCurrentTarget(target))
        .catch(() => false)
    },
    resize(id, cols, rows, claimViewport = false): boolean {
      if (id === boundId && hasMutationAccess() && !flushing) {
        const identity = mutationIdentity()
        if (identity) {
          window.api.pty.resize(id, cols, rows, identity)
        } else {
          window.api.pty.resize(id, cols, rows)
        }
        if (claimViewport) {
          if (identity) {
            window.api.pty.claimViewport(id, cols, rows, identity)
          } else {
            window.api.pty.claimViewport(id, cols, rows)
          }
        }
        return true
      }
      return enqueue({ kind: 'resize', id, bindingRevision, cols, rows, claim: claimViewport })
    },
    claimViewport: (id, cols, rows) =>
      enqueue({ kind: 'claim-viewport', id, bindingRevision, cols, rows }),
    signal: (id, signal) => enqueue({ kind: 'signal', id, bindingRevision, signal }),
    clearBuffer: (id) => enqueue({ kind: 'clear', id, bindingRevision }),
    kill: (id, keepHistory = false) =>
      id === boundId && hasMutationAccess() && !flushing && !terminalError
        ? killPtyWithMutationIdentity(
            id,
            keepHistory,
            access.mode === 'exact' ? access.identity : undefined
          )
        : new Promise<void>((resolve, reject) =>
            enqueue({ kind: 'kill', id, bindingRevision, keepHistory, resolve, reject })
          ),
    release(): void {
      bindingRevision += 1
      accessClaim.cancel()
      boundId = null
      bindingTarget = null
      preparedClaimant = null
      access = { mode: 'unavailable' }
      terminalError = new Error('pty_mutation_access_released')
      settlePending(terminalError)
    }
  }
}
