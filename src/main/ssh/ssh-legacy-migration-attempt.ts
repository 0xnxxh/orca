import type {
  SshLegacyMigrationCoordinatorInput,
  SshLegacyMigrationOutcome,
  SshLegacyMigrationUnresolvedPhase
} from './ssh-legacy-migration-coordinator-types'
import {
  sshLegacyMigrationErrorMessage,
  unresolvedSshLegacyMigrationOutcome
} from './ssh-legacy-migration-outcome'

export class SshLegacyMigrationAttemptSupersededError extends Error {
  readonly name = 'SshLegacyMigrationAttemptSupersededError'
}

export function assertSshLegacyMigrationAttempt(
  input: Pick<SshLegacyMigrationCoordinatorInput, 'signal' | 'isAttemptCurrent'>
): void {
  input.signal.throwIfAborted()
  if (!input.isAttemptCurrent()) {
    throw new SshLegacyMigrationAttemptSupersededError(
      'SSH legacy migration attempt was superseded'
    )
  }
}

export function rethrowSshLegacyMigrationAttemptStop(
  input: Pick<SshLegacyMigrationCoordinatorInput, 'signal' | 'isAttemptCurrent'>,
  error: unknown
): void {
  input.signal.throwIfAborted()
  if (!input.isAttemptCurrent() || error instanceof SshLegacyMigrationAttemptSupersededError) {
    throw new SshLegacyMigrationAttemptSupersededError(
      'SSH legacy migration attempt was superseded'
    )
  }
}

export function sshLegacyEvidenceContext(input: SshLegacyMigrationCoordinatorInput) {
  return Object.freeze({
    targetId: input.targetId,
    authorityHostId: input.authorityHostId,
    hostPathFlavor: input.hostPathFlavor,
    attemptId: input.attemptId,
    signal: input.signal
  })
}

export async function awaitSshLegacyEvidencePhase<T>(
  input: SshLegacyMigrationCoordinatorInput,
  phase: Extract<SshLegacyMigrationUnresolvedPhase, 'worker-discovery' | 'evidence'>,
  operation: () => Promise<T>
): Promise<
  | Readonly<{ kind: 'value'; value: T }>
  | Readonly<{ kind: 'outcome'; outcome: SshLegacyMigrationOutcome }>
> {
  try {
    assertSshLegacyMigrationAttempt(input)
    const value = await operation()
    assertSshLegacyMigrationAttempt(input)
    return Object.freeze({ kind: 'value', value })
  } catch (error) {
    rethrowSshLegacyMigrationAttemptStop(input, error)
    return Object.freeze({
      kind: 'outcome',
      outcome: unresolvedSshLegacyMigrationOutcome(
        phase,
        sshLegacyMigrationErrorMessage(error),
        'none'
      )
    })
  }
}
