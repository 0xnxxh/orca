import type { TerminalAuthorityNamespaceAdmissionGrant } from '../../shared/terminal-session-authority-consumer-proof'
import type { TerminalAuthorityAuthenticatedNamespaceSession } from './terminal-session-authority-authenticated-sessions'
import type {
  TerminalAuthorityAdmissionLiveGrant,
  TerminalAuthorityNamespaceAdmissionPreparation
} from './terminal-session-authority-consumer-admission-state'
import type { TerminalAuthorityAuthenticatedConsumerTransport } from './terminal-session-authority-consumer-admission-request'
import { joinTerminalAuthorityRollbackFailure } from './terminal-session-authority-consumer-rollback-failure'
import type {
  TerminalAuthorityPolicyConsumerConnection,
  TerminalAuthorityPolicyNamespacePreparation
} from './terminal-session-authority-policy-consumers'

export type TerminalAuthorityAuthenticatedNamespacePreparation = Readonly<{
  grant: TerminalAuthorityNamespaceAdmissionGrant
  policyConsumer: TerminalAuthorityPolicyConsumerConnection
  commit(): Promise<TerminalAuthorityAuthenticatedNamespaceSession>
  rollback(): Promise<void>
}>

type PreparationInput = Readonly<{
  prepared: TerminalAuthorityNamespaceAdmissionPreparation
  policyPreparation: TerminalAuthorityPolicyNamespacePreparation
  policyConsumer: TerminalAuthorityPolicyConsumerConnection
  transport: TerminalAuthorityAuthenticatedConsumerTransport
  liveGrant(): TerminalAuthorityAdmissionLiveGrant | null
  releaseNamespace(): void
  remember(release: () => void): TerminalAuthorityAuthenticatedNamespaceSession
  settled(): void
}>

/**
 * The authenticated admission's commit gate. `policyPreparation.commit()` settles the grant, the
 * exact-retry publication, and the durable claim in one serialized namespace operation, so nothing
 * here re-commits admission state.
 */
export function terminalAuthorityAuthenticatedNamespacePreparation(
  input: PreparationInput
): TerminalAuthorityAuthenticatedNamespacePreparation {
  const { prepared, policyPreparation, policyConsumer } = input
  let state: 'prepared' | 'committing' | 'committed' | 'closed' = 'prepared'
  let committedSession: TerminalAuthorityAuthenticatedNamespaceSession | null = null
  let commitPromise: Promise<TerminalAuthorityAuthenticatedNamespaceSession> | null = null
  const assertAdmissionLive = (): void => {
    const live = input.liveGrant()
    if (
      !live ||
      live.connectionGrantId !== prepared.grant.connectionGrantId ||
      live.requestId !== prepared.grant.requestId ||
      live.processIncarnationId !== prepared.grant.consumer.consumerIncarnationId
    ) {
      throw new Error('terminal authority namespace admission was canceled')
    }
  }
  return Object.freeze({
    grant: prepared.grant,
    policyConsumer,
    commit: () => {
      if (state === 'committed') {
        return Promise.resolve(committedSession!)
      }
      if (state === 'committing') {
        return commitPromise!
      }
      if (state !== 'prepared') {
        return Promise.reject(
          new Error('terminal authority namespace admission preparation is stale')
        )
      }
      state = 'committing'
      commitPromise = (async () => {
        try {
          await policyPreparation.commit()
          assertAdmissionLive()
          committedSession = input.remember(() => input.releaseNamespace())
          state = 'committed'
          input.settled()
          return committedSession
        } catch (error) {
          state = 'closed'
          input.settled()
          // Releasing the namespace is not a rewind: only the in-memory grant goes, and the durable
          // claim it settled with stands for a fresh proof to resume.
          return await joinTerminalAuthorityRollbackFailure(error, async () => {
            await policyPreparation.rollback()
            if (prepared.published) {
              input.releaseNamespace()
            }
            prepared.rollback()
            policyConsumer.disconnect()
          })
        }
      })()
      return commitPromise
    },
    rollback: async () => {
      if (state === 'closed') {
        return
      }
      if (state === 'committing') {
        try {
          const session = await commitPromise!
          session.disconnect()
        } catch {
          // Commit cleanup already closed the preparation.
        }
        state = 'closed'
        input.settled()
        return
      }
      if (state === 'committed') {
        committedSession?.disconnect()
        state = 'closed'
        input.settled()
        return
      }
      state = 'closed'
      input.settled()
      try {
        await policyPreparation.rollback()
      } finally {
        policyConsumer.disconnect()
        prepared.rollback()
      }
    }
  })
}
