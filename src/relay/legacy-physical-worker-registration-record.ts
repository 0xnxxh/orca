import {
  legacyPhysicalWorkerRegistrationIsReachable,
  type LegacyPhysicalWorkerRegistration
} from './legacy-physical-worker-registration'
import type { LegacyPhysicalWorkerPtyIdentity } from './legacy-physical-worker-client'
import type { LegacyPhysicalWorkerPty } from './legacy-physical-worker-inventory'

export type LegacyPhysicalWorkerRegistrationRecord = LegacyPhysicalWorkerRegistration & {
  removeCloseListener: () => void
  routeGeneration: number
  reachable: boolean
  removed: boolean
  ptyIdentities: readonly LegacyPhysicalWorkerPty[]
}

export function createLegacyPhysicalWorkerRegistrationRecord(
  registration: LegacyPhysicalWorkerRegistration,
  ptyIdentities: readonly LegacyPhysicalWorkerPty[],
  routeGeneration: number,
  onClosed: (record: LegacyPhysicalWorkerRegistrationRecord) => void
): LegacyPhysicalWorkerRegistrationRecord {
  const record: LegacyPhysicalWorkerRegistrationRecord = {
    ...registration,
    routeGeneration,
    reachable: true,
    removed: false,
    ptyIdentities: Object.freeze(structuredClone(ptyIdentities)),
    removeCloseListener: () => {}
  }
  record.removeCloseListener = registration.client.onClose(() => {
    if (record.removed) {
      return
    }
    record.reachable = false
    onClosed(record)
  })
  return record
}

export async function legacyPhysicalWorkerRecordIsReachable(
  record: LegacyPhysicalWorkerRegistrationRecord
): Promise<boolean> {
  return !record.removed && (await legacyPhysicalWorkerRegistrationIsReachable(record))
}

export function publicLegacyPhysicalWorkerRegistration(
  record: LegacyPhysicalWorkerRegistrationRecord
): LegacyPhysicalWorkerRegistration {
  return Object.freeze({
    route: record.route,
    cutover: record.cutover,
    client: record.client,
    processMatches: record.processMatches
  })
}

export async function legacyPhysicalWorkerRegistrationHasPty(
  registration: LegacyPhysicalWorkerRegistration,
  pty: LegacyPhysicalWorkerPtyIdentity
): Promise<boolean> {
  let inventory
  try {
    inventory = await registration.client.listPtys()
  } catch {
    return false
  }
  return (
    registration.client.isOpen() &&
    inventory.some(
      (candidate) => candidate.id === pty.id && candidate.incarnationId === pty.incarnationId
    )
  )
}

export function retireLegacyPhysicalWorkerRegistrationRecord(
  record: LegacyPhysicalWorkerRegistrationRecord,
  close: boolean
): void {
  record.removed = true
  record.reachable = false
  record.removeCloseListener()
  if (!close) {
    return
  }
  try {
    record.client.close()
  } catch {
    /* The registry no longer routes this connection. */
  }
}
