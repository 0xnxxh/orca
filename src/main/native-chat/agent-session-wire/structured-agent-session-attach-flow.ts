// The attach transition end to end: reserve the lease, make the reservation
// real, open the journal.
//
// Split out of the host so the sequence reads in one place. The host still owns
// the decisions that must not be client-supplied — the spawn token, the claim
// key, the owner probe — and passes them in.

import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult
} from '../../../shared/agent-session-wire'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import {
  admitAttachOrRefuse,
  attachJournal,
  classifyStoreFailure,
  journalIdentityFor,
  reserveRequestFor,
  type AgentSessionAttachAuthority,
  type AgentSessionAttachParams,
  type AttachedJournal
} from './structured-agent-session-attach'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'

export type AttachFlowInput = {
  store: AgentSessionRecordStore
  adapter: StructuredAgentSessionAdapter
  journalRoot: string
  authority: AgentSessionAttachAuthority
  callerKey: string
  params: AgentSessionAttachParams
  now: () => number
  /** Registers the opened journal and fans out to subscribers before the caller
   *  sees the result, so no client can send against a session the host has not
   *  finished publishing. */
  onAttached: (attached: AttachedJournal) => void
}

export async function performAttach(
  input: AttachFlowInput
): Promise<AgentSessionMutationResult<AgentSessionAttachResult>> {
  const { params, store } = input
  const sessionId = params.envelope.sessionId
  const admitted = admitAttachOrRefuse(params)
  if (!admitted.ok) {
    return admitted
  }

  let record: AgentSessionRecord
  let replayed = false
  try {
    const reserved = await store.reserveOwner(
      reserveRequestFor({
        sessionId,
        params,
        authority: input.authority,
        callerKey: input.callerKey,
        fingerprint: admitted.fingerprint,
        now: input.now()
      })
    )
    record = reserved.record
    replayed = reserved.disposition === 'replayed'
    if (record.lease.ownerProcess === null) {
      record = await acquireOwner(input, record)
    }
  } catch (error) {
    return {
      ok: false,
      refusal: classifyStoreFailure(error, store.getRecord(sessionId)?.lease.runtimeFence ?? null)
    }
  }

  const attached = await attachJournal({
    record,
    params,
    journalRoot: input.journalRoot,
    adapter: input.adapter
  })
  input.onAttached(attached)
  await store.recordOperationOutcome({
    callerKey: input.callerKey,
    operationId: params.envelope.clientOperationId,
    outcome: { status: 'succeeded', sessionId }
  })

  const fence = record.lease.runtimeFence
  return {
    ok: true,
    replayed,
    fence,
    cursor: attached.journal.cursor(),
    value: {
      sessionId,
      fence,
      snapshot: attached.journal.snapshot(),
      unconfirmedClientMessageIds: attached.unconfirmedClientMessageIds
    }
  }
}

/** A reservation with no process behind it is only a promise to spawn; the
 *  adapter makes it real and the store then grants the writer. */
async function acquireOwner(
  input: AttachFlowInput,
  record: AgentSessionRecord
): Promise<AgentSessionRecord> {
  const fence = record.lease.runtimeFence
  const acquired = await input.adapter.acquire({
    identity: journalIdentityFor(record.sessionId, input.params),
    fence,
    spawnToken: input.authority.spawnToken
  })
  await input.store.commitProcessIdentity({
    sessionId: record.sessionId,
    fence,
    process: acquired.process,
    now: input.now()
  })
  return input.store.proveOwner({
    sessionId: record.sessionId,
    fence,
    link: acquired.link,
    now: input.now()
  })
}
