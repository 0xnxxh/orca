import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalSessionAuthorityServiceOptions } from './terminal-session-authority-service-contract'
import type { TerminalAuthorityWriterClaimVerifier } from './terminal-authority-writer-recovery'

export type TerminalAuthorityRegistryOptions = Omit<
  TerminalSessionAuthorityServiceOptions,
  'directory' | 'namespace' | 'takeoverOwnerToken' | 'legacyWorkerAccess'
> &
  Readonly<{
    directory: string
    authorityHostId: string
    takeoverOwnerToken?: string
    maxNamespaces?: number
    createNamespaceId?: () => string
    onNamespaceServiceOpen?: (namespace: TerminalAuthorityNamespace) => void
    writerClaimIsGone?: TerminalAuthorityWriterClaimVerifier
    legacyMigration?: Readonly<{ now?: () => number }>
  }>
