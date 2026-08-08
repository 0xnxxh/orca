import { randomUUID } from 'node:crypto'
import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import { TerminalSessionAuthorityState } from '../../shared/terminal-session-authority-state'
import {
  TerminalAuthorityRuntimeAccess,
  type TerminalAuthorityWriterAccess
} from './terminal-session-authority-access'
import { TerminalAuthorityFileStore } from './terminal-session-authority-file-store'
import type { TerminalSessionAuthorityServiceOptions } from './terminal-session-authority-service-contract'
import {
  resolveTerminalAuthorityObserverLimit,
  validateTerminalSessionAuthorityServiceOptions
} from './terminal-session-authority-service-options'
import { TerminalAuthorityWriterLock } from './terminal-session-authority-writer-lock'

export type OpenTerminalSessionAuthorityServiceState = Readonly<{
  state: TerminalSessionAuthorityState
  store: TerminalAuthorityFileStore
  accesses: TerminalAuthorityRuntimeAccess
  writerAccess: TerminalAuthorityWriterAccess
}>

export async function openTerminalSessionAuthorityServiceState(
  options: TerminalSessionAuthorityServiceOptions
): Promise<OpenTerminalSessionAuthorityServiceState> {
  validateTerminalSessionAuthorityServiceOptions(options)
  const createRuntimeId = options.createRuntimeId ?? randomUUID
  const serviceInstanceId = createRuntimeId()
  assertAuthorityId(serviceInstanceId, 'serviceInstanceId')
  const lock = await TerminalAuthorityWriterLock.acquire({
    directory: options.directory,
    ownerToken: options.ownerToken,
    takeoverOwnerToken: options.takeoverOwnerToken,
    allowUninitializedTakeover: options.allowUninitializedTakeover
  })
  try {
    const opened = await TerminalAuthorityFileStore.open({
      directory: options.directory,
      namespace: options.namespace,
      lock,
      maxCheckpointBytes: options.maxCheckpointBytes,
      maxLogBytes: options.maxLogBytes,
      onCrashBoundary: options.onAuthorityCrashBoundary
    })
    const state = restoreAuthorityState(options, opened.checkpoint, lock.identity.epoch)
    replayAuthorityRecords(opened.records, state, lock.identity.epoch)
    state.setWriterEpoch(lock.identity.epoch)
    const writerAccess = Object.freeze({
      role: 'writer' as const,
      serviceInstanceId,
      actorId: options.writerActorId,
      ownerToken: lock.identity.ownerToken,
      writerEpoch: lock.identity.epoch
    })
    const accesses = new TerminalAuthorityRuntimeAccess(
      serviceInstanceId,
      writerAccess,
      createRuntimeId,
      resolveTerminalAuthorityObserverLimit(options.maxObservers)
    )
    return Object.freeze({
      state,
      store: opened.store,
      accesses,
      writerAccess
    })
  } catch (error) {
    await lock.release().catch(() => undefined)
    throw error
  }
}

function restoreAuthorityState(
  options: TerminalSessionAuthorityServiceOptions,
  checkpoint: ReturnType<TerminalSessionAuthorityState['snapshot']> | null,
  writerEpoch: number
): TerminalSessionAuthorityState {
  if (checkpoint && checkpoint.writerEpoch > writerEpoch) {
    failTerminalSessionAuthority('record-corrupt', 'authority snapshot has a future writer epoch')
  }
  return checkpoint
    ? TerminalSessionAuthorityState.restore(
        checkpoint,
        writerEpoch,
        options.ownerIncarnationId,
        options
      )
    : new TerminalSessionAuthorityState(
        options.namespace,
        writerEpoch,
        options.ownerIncarnationId,
        options
      )
}

function replayAuthorityRecords(
  records: Awaited<ReturnType<typeof TerminalAuthorityFileStore.open>>['records'],
  state: TerminalSessionAuthorityState,
  writerEpoch: number
): void {
  for (const record of records) {
    if (record.writerEpoch > writerEpoch) {
      failTerminalSessionAuthority('record-corrupt', 'authority log has a future writer epoch')
    }
    state.applyEvent(record.event)
  }
}
