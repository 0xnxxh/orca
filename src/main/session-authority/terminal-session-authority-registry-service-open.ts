import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalAuthorityLegacyWorkerAccess } from './terminal-session-authority-service-contract'
import { terminalSessionAuthorityNamespaceDirectory } from './terminal-session-authority-namespace-directory'
import type { TerminalAuthorityRegistryOptions } from './terminal-session-authority-registry-options'
import { TerminalSessionAuthorityService } from './terminal-session-authority-service'
import { openTerminalAuthorityWriterWithRecovery } from './terminal-authority-writer-recovery'
import type { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'

export async function openTerminalAuthorityRegistryService(options: {
  registry: TerminalAuthorityRegistryOptions
  rootLock: TerminalAuthorityWriterLock
  namespace: TerminalAuthorityNamespace
  legacyWorkerAccess: TerminalAuthorityLegacyWorkerAccess
}): Promise<TerminalSessionAuthorityService> {
  const directory = terminalSessionAuthorityNamespaceDirectory(
    options.registry.directory,
    options.namespace
  )
  return await openTerminalAuthorityWriterWithRecovery({
    directory,
    claimIsGone: async (ownerToken) =>
      ownerToken === options.rootLock.replacedOwnerToken ||
      (await options.registry.writerClaimIsGone?.(ownerToken)) === true,
    open: (takeoverOwnerToken) =>
      TerminalSessionAuthorityService.open({
        ...options.registry,
        directory,
        namespace: options.namespace,
        ...(takeoverOwnerToken ? { takeoverOwnerToken } : {}),
        allowUninitializedTakeover: takeoverOwnerToken !== undefined,
        legacyWorkerAccess: options.legacyWorkerAccess
      })
  })
}
