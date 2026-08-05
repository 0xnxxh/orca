import { deleteHostDeviceToken } from './host-device-token-store'
import {
  clearHostCredentialWriteRevision,
  getHostCredentialWriteRevision
} from './host-credential-write-revision'
import { deleteMobileRelayCredentialBundle } from './mobile-relay-credential-bundle'
import { deleteMobileRelayDirectUpgradeJournal } from './mobile-relay-direct-upgrade-journal'

type DeletionDependencies = {
  waitForHostMutations: () => Promise<void>
  hasStoredHost: (hostId: string) => Promise<boolean>
  onDeleted: (hostId: string) => void
}

export function createUnpairedHostCredentialDeletion(dependencies: DeletionDependencies) {
  function writeRevisionChanged(hostId: string, writeRevision: number): boolean {
    return getHostCredentialWriteRevision(hostId) !== writeRevision
  }

  async function shouldSkip(hostId: string, writeRevision: number): Promise<boolean> {
    if (writeRevisionChanged(hostId, writeRevision)) {
      return true
    }
    await dependencies.waitForHostMutations()
    if (writeRevisionChanged(hostId, writeRevision)) {
      return true
    }
    return (await dependencies.hasStoredHost(hostId)) || writeRevisionChanged(hostId, writeRevision)
  }

  return async (hostId: string, writeRevision: number): Promise<void> => {
    if ((await shouldSkip(hostId, writeRevision)) || writeRevisionChanged(hostId, writeRevision)) {
      return
    }
    await deleteHostDeviceToken(hostId)
    if ((await shouldSkip(hostId, writeRevision)) || writeRevisionChanged(hostId, writeRevision)) {
      return
    }
    await deleteMobileRelayCredentialBundle(hostId)
    if ((await shouldSkip(hostId, writeRevision)) || writeRevisionChanged(hostId, writeRevision)) {
      return
    }
    await deleteMobileRelayDirectUpgradeJournal(hostId)
    if (writeRevisionChanged(hostId, writeRevision)) {
      return
    }
    clearHostCredentialWriteRevision(hostId)
    dependencies.onDeleted(hostId)
  }
}
