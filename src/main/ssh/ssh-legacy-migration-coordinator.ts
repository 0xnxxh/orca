import { relayDaemonGrantHasTerminalLegacyCutover } from '../../shared/terminal-legacy-cutover'
import { sshLegacyEvidenceId } from './ssh-legacy-migration-evidence-identity'
import { planSshLegacyMigrationInventory } from './ssh-legacy-migration-inventory-planner'
import type { SshLegacyMigrationInventoryPlan } from './ssh-legacy-migration-inventory-types'
import {
  collectSshLegacyGc,
  commitSshLegacyMigrationBarrier,
  inspectSshLegacyWorker,
  migrateSshLegacyWorker,
  readSshLegacyGcProtection,
  type SshLegacyWorkerMigrationCommit,
  type SshLegacyWorkerMigrationOperation
} from './ssh-legacy-migration-rpc'
import {
  assertSshLegacyMigrationAttempt,
  awaitSshLegacyEvidencePhase,
  rethrowSshLegacyMigrationAttemptStop,
  sshLegacyEvidenceContext
} from './ssh-legacy-migration-attempt'
import {
  assertInspectionDigest,
  assertInventoryIdentity,
  assertInventoryMatchesInspections,
  assertPlanCoverage,
  validatedWorkers,
  workerCatalog,
  workerOperation
} from './ssh-legacy-migration-coordinator-plan'
import {
  committedSshLegacyMigrationOutcome,
  sshLegacyMigrationErrorMessage,
  unresolvedSshLegacyMigrationOutcome
} from './ssh-legacy-migration-outcome'
import type {
  LegacyPhysicalWorkerDescriptor,
  SshLegacyInspectedWorker,
  SshLegacyMigrationCoordinatorInput,
  SshLegacyMigrationOutcome
} from './ssh-legacy-migration-coordinator-types'

export { SshLegacyMigrationAttemptSupersededError } from './ssh-legacy-migration-attempt'

export async function coordinateSshLegacyMigration(
  input: SshLegacyMigrationCoordinatorInput
): Promise<SshLegacyMigrationOutcome> {
  if (!relayDaemonGrantHasTerminalLegacyCutover(input.authorityCapabilities)) {
    return Object.freeze({ kind: 'read-only', reason: 'capability-not-negotiated' })
  }
  if (!input.evidenceProvider) {
    return unresolvedSshLegacyMigrationOutcome(
      'worker-discovery',
      'migration evidence provider is unavailable',
      'none'
    )
  }
  assertSshLegacyMigrationAttempt(input)
  const discovery = await awaitSshLegacyEvidencePhase(input, 'worker-discovery', () =>
    input.evidenceProvider!.discoverWorkers(sshLegacyEvidenceContext(input))
  )
  if (discovery.kind === 'outcome') {
    return discovery.outcome
  }
  if (discovery.value.kind === 'unresolved') {
    return unresolvedSshLegacyMigrationOutcome('worker-discovery', discovery.value.reason, 'none')
  }
  let workers: readonly LegacyPhysicalWorkerDescriptor[]
  try {
    workers = validatedWorkers(discovery.value.workers)
  } catch (error) {
    return unresolvedSshLegacyMigrationOutcome(
      'worker-discovery',
      sshLegacyMigrationErrorMessage(error),
      'none'
    )
  }

  const inspected: SshLegacyInspectedWorker[] = []
  for (const worker of workers) {
    try {
      assertSshLegacyMigrationAttempt(input)
      const inspection = await inspectSshLegacyWorker({
        rpc: input.rpc,
        worker,
        signal: input.signal
      })
      assertSshLegacyMigrationAttempt(input)
      assertInspectionDigest(worker, inspection)
      inspected.push(Object.freeze({ descriptor: worker, inspection }))
    } catch (error) {
      rethrowSshLegacyMigrationAttemptStop(input, error)
      return unresolvedSshLegacyMigrationOutcome(
        'inspection',
        sshLegacyMigrationErrorMessage(error),
        'none',
        worker.workerId
      )
    }
  }

  const evidence = await awaitSshLegacyEvidencePhase(input, 'evidence', () =>
    input.evidenceProvider!.buildInventory({
      ...sshLegacyEvidenceContext(input),
      workers: Object.freeze(inspected)
    })
  )
  if (evidence.kind === 'outcome') {
    return evidence.outcome
  }
  if (evidence.value.kind === 'unresolved') {
    return unresolvedSshLegacyMigrationOutcome('evidence', evidence.value.reason, 'none')
  }
  let plan: SshLegacyMigrationInventoryPlan
  try {
    assertInventoryIdentity(input, evidence.value.inventory)
    assertInventoryMatchesInspections(evidence.value.inventory.liveRelays, inspected)
    plan = planSshLegacyMigrationInventory(evidence.value.inventory)
    assertPlanCoverage(plan, inspected)
  } catch (error) {
    return unresolvedSshLegacyMigrationOutcome(
      'planning',
      sshLegacyMigrationErrorMessage(error),
      'none'
    )
  }

  const receipts: Readonly<{
    workerId: string
    receiptId: string
    sequence: number
    duplicate: boolean
  }>[] = []
  for (const prepared of inspected) {
    const workerId = prepared.descriptor.workerId
    const hasCandidates = [...plan.imports, ...plan.unresolved].some(
      (candidate) => candidate.physicalPty.workerId === workerId
    )
    if (!hasCandidates) {
      if (prepared.inspection.ptys.length > 0) {
        return unresolvedSshLegacyMigrationOutcome(
          'planning',
          'prepared worker inventory was not cataloged',
          'none'
        )
      }
      continue
    }
    const catalog = workerCatalog(plan, workerId)
    const operation = workerOperation(plan, prepared, catalog)
    const committed = await commitWorker(input, prepared.descriptor, operation, receipts.length)
    if (committed.kind === 'outcome') {
      return committed.outcome
    }
    receipts.push(
      Object.freeze({
        workerId: prepared.descriptor.workerId,
        receiptId: committed.value.receipt.receiptId,
        sequence: committed.value.receipt.sequence,
        duplicate: committed.value.duplicate
      })
    )
  }

  let catalogRevision: number
  const barrierIdSeed = Object.freeze(receipts.map(({ receiptId }) => receiptId).sort())
  try {
    assertSshLegacyMigrationAttempt(input)
    catalogRevision = await readSshLegacyGcProtection({ rpc: input.rpc, signal: input.signal })
    assertSshLegacyMigrationAttempt(input)
    if (receipts.some((receipt) => receipt.sequence > catalogRevision)) {
      throw new Error('legacy catalog revision precedes a committed receipt')
    }
  } catch (error) {
    rethrowSshLegacyMigrationAttemptStop(input, error)
    return unresolvedSshLegacyMigrationOutcome(
      'barrier',
      sshLegacyMigrationErrorMessage(error),
      'catalog-committed'
    )
  }
  const barrierId = sshLegacyEvidenceId('ssh-legacy-barrier', [
    plan.migrationId,
    barrierIdSeed,
    catalogRevision
  ])
  try {
    assertSshLegacyMigrationAttempt(input)
    await commitSshLegacyMigrationBarrier({
      rpc: input.rpc,
      barrierId,
      catalogRevision,
      signal: input.signal
    })
    assertSshLegacyMigrationAttempt(input)
  } catch (error) {
    rethrowSshLegacyMigrationAttemptStop(input, error)
    return unresolvedSshLegacyMigrationOutcome(
      'barrier',
      sshLegacyMigrationErrorMessage(error),
      'catalog-committed'
    )
  }

  try {
    const removed = await collectSshLegacyGc({
      rpc: input.rpc,
      barrierId,
      signal: input.signal
    })
    assertSshLegacyMigrationAttempt(input)
    return committedSshLegacyMigrationOutcome(plan, receipts, barrierId, catalogRevision, {
      kind: 'completed',
      removed
    })
  } catch (error) {
    rethrowSshLegacyMigrationAttemptStop(input, error)
    return committedSshLegacyMigrationOutcome(plan, receipts, barrierId, catalogRevision, {
      kind: 'pending',
      reason: sshLegacyMigrationErrorMessage(error)
    })
  }
}

async function commitWorker(
  input: SshLegacyMigrationCoordinatorInput,
  worker: LegacyPhysicalWorkerDescriptor,
  operation: SshLegacyWorkerMigrationOperation,
  priorCommitCount: number
): Promise<
  | Readonly<{ kind: 'commit'; value: SshLegacyWorkerMigrationCommit }>
  | Readonly<{ kind: 'outcome'; outcome: SshLegacyMigrationOutcome }>
> {
  try {
    assertSshLegacyMigrationAttempt(input)
    const committed = await migrateSshLegacyWorker({
      rpc: input.rpc,
      worker,
      operation,
      signal: input.signal
    })
    assertSshLegacyMigrationAttempt(input)
    return { kind: 'commit', value: committed }
  } catch (error) {
    rethrowSshLegacyMigrationAttemptStop(input, error)
    return {
      kind: 'outcome',
      outcome: unresolvedSshLegacyMigrationOutcome(
        'catalog-commit',
        sshLegacyMigrationErrorMessage(error),
        priorCommitCount > 0 ? 'catalog-partially-committed' : 'commit-uncertain',
        worker.workerId
      )
    }
  }
}
