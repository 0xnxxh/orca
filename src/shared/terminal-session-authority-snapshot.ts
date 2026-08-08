import { assertAuthorityNamespace, isRecord } from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthoritySnapshot
} from './terminal-session-authority-mutation'
import { assertSafeInteger } from './terminal-session-authority-record-validation'

export function assertTerminalSessionAuthoritySnapshotEnvelope(
  snapshot: unknown
): asserts snapshot is TerminalSessionAuthoritySnapshot {
  if (!isRecord(snapshot) || snapshot.version !== 1) {
    failTerminalSessionAuthority('record-corrupt', 'authority snapshot version is invalid')
  }
  assertAuthorityNamespace(snapshot.namespace)
  assertSafeInteger(snapshot.writerEpoch, 'snapshot writer epoch', 1)
  assertSafeInteger(snapshot.revision, 'snapshot revision')
  assertSafeInteger(snapshot.outcomeFloorSequence, 'outcome floor sequence')
  assertSafeInteger(snapshot.nextOutcomeSequence, 'next outcome sequence', 1)
  if (
    !Array.isArray(snapshot.panes) ||
    !Array.isArray(snapshot.allocations) ||
    !Array.isArray(snapshot.consumers) ||
    !Array.isArray(snapshot.outcomes) ||
    !Array.isArray(snapshot.semanticProducers) ||
    (snapshot.materializedOutcomes !== undefined &&
      !Array.isArray(snapshot.materializedOutcomes)) ||
    !Array.isArray(snapshot.legacyMigrations)
  ) {
    failTerminalSessionAuthority('record-corrupt', 'authority snapshot shape is invalid')
  }
  let previousLegacyRevision = 0
  for (const migration of snapshot.legacyMigrations) {
    const authorityRevision = isRecord(migration) ? migration.authorityRevision : null
    if (
      typeof authorityRevision !== 'number' ||
      !Number.isSafeInteger(authorityRevision) ||
      authorityRevision <= previousLegacyRevision ||
      authorityRevision > snapshot.revision
    ) {
      failTerminalSessionAuthority(
        'record-corrupt',
        'legacy migration snapshot revision is inconsistent'
      )
    }
    previousLegacyRevision = authorityRevision
  }
}
