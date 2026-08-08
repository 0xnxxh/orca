import type { BoundPtyMutationAccess } from './pty-mutation-binding-target'
import { killPtyWithMutationIdentity, type PendingPtyMutation } from './pty-mutation-operation'

export async function dispatchPtyMutationOperation(
  operation: PendingPtyMutation,
  access: BoundPtyMutationAccess,
  isCurrent: () => boolean
): Promise<void> {
  const identity = access.mode === 'exact' ? access.identity : undefined
  switch (operation.kind) {
    case 'write-accepted':
      operation.resolve(
        (await (
          identity
            ? window.api.pty.writeAccepted(operation.id, operation.data, identity)
            : window.api.pty.writeAccepted(operation.id, operation.data)
        ).catch(() => false)) && isCurrent()
      )
      break
    case 'resize':
      if (identity) {
        window.api.pty.resize(operation.id, operation.cols, operation.rows, identity)
      } else {
        window.api.pty.resize(operation.id, operation.cols, operation.rows)
      }
      if (operation.claim) {
        if (identity) {
          window.api.pty.claimViewport(operation.id, operation.cols, operation.rows, identity)
        } else {
          window.api.pty.claimViewport(operation.id, operation.cols, operation.rows)
        }
      }
      break
    case 'claim-viewport':
      if (identity) {
        window.api.pty.claimViewport(operation.id, operation.cols, operation.rows, identity)
      } else {
        window.api.pty.claimViewport(operation.id, operation.cols, operation.rows)
      }
      break
    case 'signal':
      if (identity) {
        window.api.pty.signal(operation.id, operation.signal, identity)
      } else {
        window.api.pty.signal(operation.id, operation.signal)
      }
      break
    case 'clear':
      if (identity) {
        window.api.pty.clearBuffer(operation.id, identity)
      } else {
        window.api.pty.clearBuffer(operation.id)
      }
      break
    case 'kill':
      await killPtyWithMutationIdentity(operation.id, operation.keepHistory, identity).then(
        operation.resolve,
        operation.reject
      )
      break
  }
}
