import {
  composeTerminalAuthorityConsumerAdmissionSeals,
  type TerminalAuthorityConsumerAdmissionSeal
} from './terminal-session-authority-consumer-admission-seal'
import { joinTerminalAuthorityRollbackFailure } from './terminal-session-authority-consumer-rollback-failure'
import type { TerminalSessionAuthorityPolicyConsumerSession } from './terminal-session-authority-policy-consumer-session'
import type { TerminalSessionAuthorityService } from './terminal-session-authority-service'

export type TerminalAuthorityPolicyNamespacePreparation = Readonly<{
  commit(): Promise<void>
  rollback(): Promise<void>
}>

type PreparationInput = Readonly<{
  connection: TerminalSessionAuthorityPolicyConsumerSession
  service: TerminalSessionAuthorityService
  seal?: TerminalAuthorityConsumerAdmissionSeal
  assertCurrent(): void
  assertClaimable(): void
  installOwner(): void
}>

/**
 * The staged namespace's commit gate. Its fences run inside seal() so the serialized namespace queue
 * cannot invalidate them before the append, and namespace ownership moves in commit() so nothing
 * after the durable claim can fail.
 */
export function terminalAuthorityPolicyNamespacePreparation(
  input: PreparationInput
): TerminalAuthorityPolicyNamespacePreparation {
  const { connection, service } = input
  let state: 'prepared' | 'committing' | 'committed' | 'closed' = 'prepared'
  let commitPromise: Promise<void> | null = null
  const admissionSeal = composeTerminalAuthorityConsumerAdmissionSeals([
    {
      seal: () => {
        if (state !== 'committing') {
          throw new Error('terminal authority policy consumer namespace preparation is stale')
        }
        input.assertCurrent()
        input.assertClaimable()
      },
      commit: () => input.installOwner(),
      abort: () => {}
    },
    input.seal
  ])
  return Object.freeze({
    commit: async () => {
      if (state === 'committed') {
        return
      }
      if (state === 'committing') {
        await commitPromise
        return
      }
      if (state === 'closed') {
        throw new Error('terminal authority policy consumer namespace preparation is stale')
      }
      input.assertCurrent()
      input.assertClaimable()
      state = 'committing'
      const operation = (async () => {
        try {
          await connection.commitStagedNamespace(service.namespace, admissionSeal)
          connection.activateNamespace(service.namespace)
          state = 'committed'
        } catch (error) {
          state = 'closed'
          // Joined, not dropped: a half-released namespace must not read as cleanly released.
          await joinTerminalAuthorityRollbackFailure(error, () =>
            connection.rollbackNamespace(service.namespace)
          )
        }
      })()
      commitPromise = operation
      await operation
    },
    rollback: async () => {
      if (state === 'closed') {
        return
      }
      if (state === 'committing') {
        state = 'closed'
        await commitPromise?.catch(() => undefined)
        await connection.rollbackNamespace(service.namespace)
        return
      }
      state = 'closed'
      await connection.rollbackNamespace(service.namespace)
    }
  })
}
