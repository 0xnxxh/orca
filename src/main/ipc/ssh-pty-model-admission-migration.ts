import type { SshPtyModelAdmissionKey } from './ssh-pty-model-admission-contract'
import type { AdmissionCharge, AdmissionEntry, PtyUsage } from './ssh-pty-model-admission-entry'
import { admissionError, admissionKeyId } from './ssh-pty-model-admission-entry'
import type { SshPtyModelAdmissionPressure } from './ssh-pty-model-admission-pressure'

export function beginSshPtyModelAdmissionMigration(args: {
  key: SshPtyModelAdmissionKey
  migratingPtys: Set<string>
  pressure: SshPtyModelAdmissionPressure
  usageByPty: Map<string, PtyUsage>
  release: (key: SshPtyModelAdmissionKey, charge: AdmissionCharge) => void
  cleanup: (id: string, usage: PtyUsage) => void
}): void {
  const id = admissionKeyId(args.key)
  if (args.migratingPtys.has(id)) {
    return
  }
  args.migratingPtys.add(id)
  const error = admissionError('ssh_model_migration_queued_canceled')
  args.pressure.cancelQueuedPty(args.key, error)
  const usage = args.usageByPty.get(id)
  if (!usage) {
    return
  }
  const queued = usage.queued
  usage.queued = []
  for (const entry of queued) {
    cancelQueuedEntry(entry, error, args.release)
  }
  args.cleanup(id, usage)
}

export function closeSshPtyModelAdmissionMigrations(
  migratingPtys: Set<string>,
  providerGeneration: number
): void {
  const prefix = `${providerGeneration}\0`
  for (const id of migratingPtys) {
    if (id.startsWith(prefix)) {
      migratingPtys.delete(id)
    }
  }
}

function cancelQueuedEntry(
  entry: AdmissionEntry,
  error: Error,
  release: (key: SshPtyModelAdmissionKey, charge: AdmissionCharge) => void
): void {
  if (entry.state === 'settled') {
    return
  }
  entry.state = 'settled'
  release(entry.key, entry.charge)
  entry.reject(error)
}
