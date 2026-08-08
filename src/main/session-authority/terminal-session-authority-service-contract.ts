import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityProjection,
  TerminalSessionAuthorityMutationResult
} from '../../shared/terminal-session-authority-mutation'
import type { TerminalSessionAuthorityStateOptions } from '../../shared/terminal-session-authority-state'
import type { TerminalAuthorityFileStoreOptions } from './terminal-session-authority-file-store'

export type TerminalSessionAuthorityServiceOptions = TerminalSessionAuthorityStateOptions &
  Readonly<{
    directory: string
    namespace: TerminalAuthorityNamespace
    ownerToken: string
    ownerIncarnationId: string
    writerActorId: string
    takeoverOwnerToken?: string
    allowUninitializedTakeover?: boolean
    maxObservers?: number
    createRuntimeId?: () => string
    maxCheckpointBytes?: number
    maxLogBytes?: number
    onAuthorityCrashBoundary?: TerminalAuthorityFileStoreOptions['onCrashBoundary']
    legacyWorkerAccess?: TerminalAuthorityLegacyWorkerAccess
  }>

export type TerminalAuthorityLegacyWorkerAccess = Readonly<{
  role: 'legacy-worker-owner'
  accessId: string
}>

export type TerminalAuthorityMutationReceipt = Readonly<{
  result: TerminalSessionAuthorityMutationResult
  outcomeSequence: number
}>

export type TerminalAuthorityProjectionChange = Readonly<{
  reason: 'mutation' | 'outcome' | 'legacy-import' | 'owner-reachability'
  projection: TerminalAuthorityProjection
}>

export type TerminalAuthorityProjectionListener = (
  change: TerminalAuthorityProjectionChange
) => void
