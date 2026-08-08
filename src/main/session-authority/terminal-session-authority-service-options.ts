import {
  assertAuthorityId,
  assertAuthorityNamespace,
  assertAuthorityStoragePath,
  isRecord
} from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityServiceOptions } from './terminal-session-authority-service-contract'

const DEFAULT_MAX_OBSERVERS = 128

export function validateTerminalSessionAuthorityServiceOptions(
  options: TerminalSessionAuthorityServiceOptions
): void {
  assertAuthorityStoragePath(options.directory, 'authority directory')
  assertAuthorityNamespace(options.namespace)
  assertAuthorityId(options.ownerToken, 'ownerToken')
  assertAuthorityId(options.ownerIncarnationId, 'ownerIncarnationId')
  assertAuthorityId(options.writerActorId, 'writerActorId')
  if (options.legacyWorkerAccess !== undefined) {
    if (
      !isRecord(options.legacyWorkerAccess) ||
      options.legacyWorkerAccess.role !== 'legacy-worker-owner'
    ) {
      failTerminalSessionAuthority('writer-fenced', 'legacy worker access is invalid')
    }
    assertAuthorityId(options.legacyWorkerAccess.accessId, 'legacy worker accessId')
  }
}

export function resolveTerminalAuthorityObserverLimit(value: number | undefined): number {
  const selected = value ?? DEFAULT_MAX_OBSERVERS
  if (!Number.isSafeInteger(selected) || selected < 1) {
    failTerminalSessionAuthority('capacity', 'observer capacity is invalid')
  }
  return selected
}
