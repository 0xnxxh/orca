import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import {
  isPtyIncarnationId,
  isRelayAttestedPtyIncarnationId,
  type PtyIncarnationId
} from '../../shared/pty-incarnation'
import {
  SSH_PTY_IDENTITY_MISMATCH_ERROR,
  SSH_SESSION_EXPIRED_ERROR,
  isSshPtyIdentityMismatchError,
  isSshPtyNotFoundError
} from './ssh-pty-errors'
import { toAppSshPtyId, toRelaySshPtyId } from './ssh-pty-id'
import type { PtySpawnOptions, PtySpawnResult } from './types'
import type { SshPtySpawnExitRaceTracker } from './ssh-pty-spawn-exit-race'
import type {
  PtySourceRecoveryRequest,
  PtySourceRecoveryResult
} from '../../shared/pty-source-recovery-contract'
import {
  parsePtySourceReceivingActivation,
  type PtySourceReceivingActivation
} from '../../shared/pty-source-receiving-activation'
import type { SshPtyReceivingActivationLease } from './ssh-pty-notification-routing'

export type SshPtyAttachResult = {
  replay?: string
  incarnationId?: PtyIncarnationId
  sourceRecovery?: PtySourceRecoveryResult
  sourceActivation?: PtySourceReceivingActivation
  sourceActivationLease?: SshPtyReceivingActivationLease
}

type SshPtyReattachResult = PtySpawnResult & {
  sourceRecovery?: PtySourceRecoveryResult
  sourceActivationLease?: SshPtyReceivingActivationLease
}

export function parseSshPtyAttachResult(value: unknown): SshPtyAttachResult {
  if (value === undefined || value === null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid SSH PTY attach response')
  }
  const result = value as {
    replay?: unknown
    incarnationId?: unknown
    sourceRecovery?: unknown
    sourceActivation?: unknown
  }
  if (result.replay !== undefined && typeof result.replay !== 'string') {
    throw new Error('Invalid SSH PTY attach replay')
  }
  if (result.incarnationId !== undefined && !isPtyIncarnationId(result.incarnationId)) {
    // Why: a present-but-invalid identity cannot safely fence delayed exits from a reused relay id.
    throw new Error('Invalid SSH PTY attach incarnation')
  }
  const sourceRecovery = parseSourceRecoveryResult(result.sourceRecovery)
  const sourceActivation = parsePtySourceReceivingActivation(result.sourceActivation)
  const activation =
    sourceActivation ?? (sourceRecovery?.status === 'pending' ? sourceRecovery : undefined)
  if (
    activation &&
    (!isPtyIncarnationId(result.incarnationId) ||
      activation.ptyIncarnation !== result.incarnationId ||
      (sourceRecovery?.status === 'pending' && !sameSourceActivation(activation, sourceRecovery)))
  ) {
    throw new Error('Invalid SSH PTY source activation identity')
  }
  return {
    ...(typeof result.replay === 'string' ? { replay: result.replay } : {}),
    ...(isPtyIncarnationId(result.incarnationId) ? { incarnationId: result.incarnationId } : {}),
    ...(sourceRecovery ? { sourceRecovery } : {}),
    ...(activation ? { sourceActivation: activation } : {})
  }
}

export async function requestSshPtyAttach(args: {
  mux: SshChannelMultiplexer
  relayPtyId: string
  params: Record<string, unknown>
  timeoutMs?: number
  commitSourceActivation?: boolean
  installSourceActivation?: (
    relayPtyId: string,
    activation: PtySourceReceivingActivation
  ) => SshPtyReceivingActivationLease
  rememberPtyIncarnation?: (relayPtyId: string, incarnationId: unknown) => void
}): Promise<SshPtyAttachResult> {
  let activationLease: SshPtyReceivingActivationLease | undefined
  const installFromResult = (result: SshPtyAttachResult): void => {
    if (!activationLease && result.sourceActivation && args.installSourceActivation) {
      activationLease = args.installSourceActivation(args.relayPtyId, result.sourceActivation)
    }
  }
  try {
    const rawResult = await args.mux.request('pty.attach', args.params, {
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      beforeResolve: (value) => installFromResult(parseSshPtyAttachResult(value))
    })
    const result = parseSshPtyAttachResult(rawResult)
    installFromResult(result)
    args.rememberPtyIncarnation?.(args.relayPtyId, result.incarnationId)
    if (args.commitSourceActivation) {
      activationLease?.commit()
    }
    return {
      ...result,
      ...(activationLease ? { sourceActivationLease: activationLease } : {})
    }
  } catch (error) {
    activationLease?.rollback()
    throw error
  }
}

function parseSourceRecoveryResult(value: unknown): PtySourceRecoveryResult | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid SSH PTY source recovery response')
  }
  const input = value as Record<string, unknown>
  if (input.status === 'restoreRequired' && typeof input.reason === 'string') {
    return Object.freeze({ status: 'restoreRequired', reason: input.reason })
  }
  if (
    input.status !== 'pending' ||
    typeof input.deliveryToken !== 'string' ||
    input.deliveryToken.length === 0 ||
    typeof input.ptyIncarnation !== 'string' ||
    input.ptyIncarnation.length === 0 ||
    !positiveInteger(input.clientGeneration) ||
    !positiveInteger(input.ownerGeneration) ||
    !nonNegativeInteger(input.checkpointSourceEndSu) ||
    !nonNegativeInteger(input.recoveryEndSu) ||
    Number(input.recoveryEndSu) < Number(input.checkpointSourceEndSu)
  ) {
    throw new Error('Invalid SSH PTY source recovery response')
  }
  return Object.freeze({
    status: 'pending',
    deliveryToken: input.deliveryToken,
    ptyIncarnation: input.ptyIncarnation,
    clientGeneration: Number(input.clientGeneration),
    ownerGeneration: Number(input.ownerGeneration),
    checkpointSourceEndSu: Number(input.checkpointSourceEndSu),
    recoveryEndSu: Number(input.recoveryEndSu)
  })
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function sameSourceActivation(
  left: PtySourceReceivingActivation,
  right: PtySourceReceivingActivation
): boolean {
  return (
    left.clientGeneration === right.clientGeneration &&
    left.ownerGeneration === right.ownerGeneration &&
    left.ptyIncarnation === right.ptyIncarnation &&
    left.deliveryToken === right.deliveryToken &&
    left.checkpointSourceEndSu === right.checkpointSourceEndSu &&
    left.recoveryEndSu === right.recoveryEndSu
  )
}

export type { PtySourceRecoveryRequest }

export async function reattachSshPtySession(args: {
  mux: SshChannelMultiplexer
  connectionId: string
  sessionId: string
  options: PtySpawnOptions
  rememberPtyIncarnation?: (relayPtyId: string, incarnationId: unknown) => void
  installSourceActivation?: (
    relayPtyId: string,
    activation: PtySourceReceivingActivation
  ) => SshPtyReceivingActivationLease
}): Promise<SshPtyReattachResult> {
  const relaySessionId = toRelaySshPtyId(args.connectionId, args.sessionId)
  console.warn(`[ssh-pty] spawn() called with sessionId=${args.sessionId}, attempting pty.attach`)
  try {
    // Why no expected pane identity: the relay froze it at spawn, so moving a
    // pane to another tab made it refuse a live shell — and refuse by saying
    // "not found", which read as death. It never caught what it was for either:
    // a relay restart recycling this id for a new shell leaves pane and tab
    // matching. Recycling is caught by the incarnation the attach returns.
    const attachResult = await requestSshPtyAttach({
      mux: args.mux,
      relayPtyId: relaySessionId,
      params: {
        id: relaySessionId,
        cols: args.options.cols,
        rows: args.options.rows,
        suppressReplayNotification: true,
        // The shell's own identity, so it survives a pane moving between tabs — unlike the pane
        // identity this replaced. Sent only when the host attested it: a locally synthesized
        // stand-in is not stable across reconnects and would refuse the pane its own shell. An
        // older relay ignores the field, which leaves today's permissive behaviour.
        ...(isRelayAttestedPtyIncarnationId(args.options.expectedIncarnationId)
          ? { expectedIncarnationId: args.options.expectedIncarnationId }
          : {})
      },
      installSourceActivation: args.installSourceActivation,
      rememberPtyIncarnation: args.rememberPtyIncarnation
    })
    console.warn(
      `[ssh-pty] pty.attach succeeded for ${args.sessionId}, replay=${!!attachResult.replay}`
    )
    return {
      id: toAppSshPtyId(args.connectionId, relaySessionId),
      isReattach: true,
      ...(attachResult.replay ? { replay: attachResult.replay } : {}),
      ...(attachResult.incarnationId ? { incarnationId: attachResult.incarnationId } : {}),
      ...(attachResult.sourceRecovery ? { sourceRecovery: attachResult.sourceRecovery } : {}),
      ...(attachResult.sourceActivation ? { sourceActivation: attachResult.sourceActivation } : {}),
      ...(attachResult.sourceActivationLease
        ? { sourceActivationLease: attachResult.sourceActivationLease }
        : {})
    }
  } catch (error) {
    // Why: an expired relay lease must be surfaced distinctly so the renderer clears its binding.
    console.warn(`[ssh-pty] pty.attach FAILED for ${args.sessionId}:`, error)
    // Why: the relay reports a mismatch by saying "not found", but it found the
    // pty — comparing identity is how it knows. Publishing expiry there makes
    // the renderer respawn and resume the agent a second time onto a live shell.
    if (isSshPtyIdentityMismatchError(error)) {
      throw new Error(`${SSH_PTY_IDENTITY_MISMATCH_ERROR}: ${relaySessionId}`)
    }
    if (isSshPtyNotFoundError(error)) {
      throw new Error(`${SSH_SESSION_EXPIRED_ERROR}: ${relaySessionId}`)
    }
    throw error
  }
}

export async function reattachSshPtySessionWithExitFence(
  args: Parameters<typeof reattachSshPtySession>[0] & {
    exitRaceTracker: SshPtySpawnExitRaceTracker
  }
): Promise<SshPtyReattachResult> {
  const operation = args.exitRaceTracker.begin()
  let result: SshPtyReattachResult | undefined
  try {
    result = await reattachSshPtySession(args)
    const relayPtyId = toRelaySshPtyId(args.connectionId, result.id)
    if (
      args.exitRaceTracker.didMatchingExitArrive(operation, {
        id: relayPtyId,
        incarnationId: result.incarnationId
      })
    ) {
      throw new Error('agent_session_exited_during_start')
    }
    return result
  } catch (error) {
    result?.sourceActivationLease?.rollback()
    throw error
  } finally {
    args.exitRaceTracker.finish(operation)
  }
}
