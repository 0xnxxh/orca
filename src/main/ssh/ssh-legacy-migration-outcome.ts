import type {
  SshLegacyMigrationOutcome,
  SshLegacyMigrationUnresolvedPhase
} from './ssh-legacy-migration-coordinator-types'
import type { SshLegacyMigrationInventoryPlan } from './ssh-legacy-migration-inventory-types'

type UnresolvedOutcome = Extract<SshLegacyMigrationOutcome, { kind: 'unresolved' }>
type MutationState = UnresolvedOutcome['mutationState']
type CommittedOutcome = Extract<SshLegacyMigrationOutcome, { kind: 'committed' }>

export function unresolvedSshLegacyMigrationOutcome(
  phase: SshLegacyMigrationUnresolvedPhase,
  reason: string,
  mutationState: MutationState,
  workerId?: string
): UnresolvedOutcome {
  return Object.freeze({
    kind: 'unresolved',
    phase,
    reason: boundedReason(reason),
    mutationState,
    ...(workerId ? { workerId } : {})
  })
}

export function committedSshLegacyMigrationOutcome(
  plan: SshLegacyMigrationInventoryPlan,
  receipts: CommittedOutcome['receipts'],
  barrierId: string,
  catalogRevision: number,
  gc: CommittedOutcome['gc']
): CommittedOutcome {
  return Object.freeze({
    kind: 'committed',
    summary: plan.summary,
    receipts: Object.freeze([...receipts]),
    barrierId,
    catalogRevision,
    gc
  })
}

export function sshLegacyMigrationErrorMessage(error: unknown): string {
  return boundedReason(error instanceof Error ? error.message : 'unknown migration failure')
}

function boundedReason(reason: string): string {
  const normalized = reason
    .replace(/[\r\n]/g, ' ')
    .split('\0')
    .join(' ')
    .trim()
  return normalized.slice(0, 512) || 'unknown migration failure'
}
