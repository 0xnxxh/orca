import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { LegacyRelayLaunchExclusion } from './legacy-relay-public-endpoint-fence'
import {
  createRelayOwnerGuardDirectory,
  inspectRelayOwnerGuardDirectory,
  releaseRelayOwnerGuardDirectory
} from './relay-owner-guard-directory'
import {
  createTerminalAuthorityRegistryOwnerToken,
  terminalAuthorityRegistryOwnerTokenIsGone
} from './terminal-authority-registry-owner-token'

const CUTOVER_GUARD_DIRECTORY = '.terminal-authority-cutover.lock'

export function legacyRelayCutoverExclusion(relayDirectory: string): LegacyRelayLaunchExclusion {
  const guardPath = join(relayDirectory, CUTOVER_GUARD_DIRECTORY)
  return Object.freeze({
    runExclusive: async <T>(operation: () => Promise<T>): Promise<T> => {
      const ownerToken = await createTerminalAuthorityRegistryOwnerToken(randomUUID())
      if (!(await acquireCutoverGuard(guardPath, ownerToken))) {
        throw new Error('legacy relay launch or cutover is already in progress')
      }
      let operationCompleted = false
      let operationResult!: T
      let operationError: unknown
      try {
        operationResult = await operation()
        operationCompleted = true
      } catch (error) {
        operationError = error
      }
      if (!(await releaseRelayOwnerGuardDirectory(guardPath, ownerToken))) {
        throw new Error('legacy relay cutover guard ownership changed before release')
      }
      if (!operationCompleted) {
        throw operationError
      }
      return operationResult
    }
  })
}

async function acquireCutoverGuard(guardPath: string, ownerToken: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await createRelayOwnerGuardDirectory(guardPath, ownerToken)) {
      return true
    }
    const existing = await inspectRelayOwnerGuardDirectory(guardPath)
    if (existing.status === 'missing') {
      continue
    }
    if (
      attempt > 0 ||
      existing.status !== 'owned' ||
      !(await terminalAuthorityRegistryOwnerTokenIsGone(existing.ownerToken)) ||
      !(await releaseRelayOwnerGuardDirectory(guardPath, existing.ownerToken))
    ) {
      return false
    }
  }
  return false
}
