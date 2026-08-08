import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import { sameTerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { spawnFreshSshPty } from './ssh-agent-session-create-operation'
import type { SshAgentSessionCapabilities } from './ssh-agent-session-capabilities'
import { SSH_SESSION_EXPIRED_ERROR } from './ssh-pty-errors'
import type { SshPtyLiveMembership } from './ssh-pty-live-membership'
import type { RemoteCliBridgeEnv, SshPtyExpectedIdentity } from './ssh-pty-provider-contract'
import type { SshPtyProviderOutputState } from './ssh-pty-provider-output-state'
import {
  requestSshPtyAttach,
  reattachSshPtySessionWithExitFence,
  type PtySourceRecoveryRequest,
  type SshPtyAttachResult
} from './ssh-pty-session-reattach'
import type { SshPtySpawnExitRaceTracker } from './ssh-pty-spawn-exit-race'
import { buildSshPtySpawnRequest } from './ssh-pty-spawn-request'
import { buildSshTerminalAuthorityAttachRequest } from './ssh-terminal-authority-attach-request'
import type { PtySpawnOptions, PtySpawnResult } from './types'
import type {
  TerminalAuthorityAppAdmissionLocator,
  TerminalAuthorityAppNamespaceAdmission
} from '../session-authority/terminal-authority-app-outcome-host-contract'

type SshPtySessionLifecycleOptions = Readonly<{
  mux: SshChannelMultiplexer
  connectionId: string
  remoteCliBridgeEnv?: RemoteCliBridgeEnv
  livePtyIds: SshPtyLiveMembership
  outputState: SshPtyProviderOutputState
  exitRaceTracker: SshPtySpawnExitRaceTracker
  capabilities: SshAgentSessionCapabilities
  toRelayPtyId: (id: string) => string
  toAppPtyId: (id: string) => string
  rememberAuthorityAccess: (
    relayPtyId: string,
    access: TerminalSessionAuthorityPtyAccess | undefined
  ) => void
  expectAuthorityAccess: (relayPtyId: string, access: TerminalSessionAuthorityPtyAccess) => void
  terminalAuthorityAppAdmission?: TerminalAuthorityAppNamespaceAdmission
}>

export class SshPtySessionLifecycle {
  constructor(private readonly options: SshPtySessionLifecycleOptions) {}

  async spawn(spawnOptions: PtySpawnOptions): Promise<PtySpawnResult> {
    if (spawnOptions.agentSessionEnsure && spawnOptions.sessionId) {
      throw new Error('agent_session_claim_unavailable')
    }
    if (spawnOptions.agentSessionEnsure) {
      const supportsClaims = await this.options.capabilities.supportsClaims({
        signal: spawnOptions.signal
      })
      if (spawnOptions.signal?.aborted) {
        throw new Error('client_disconnected')
      }
      if (!supportsClaims) {
        throw new Error('agent_session_claim_unavailable')
      }
    }
    return await this.withTerminalAuthorityAdmission(
      this.spawnAdmissionLocator(spawnOptions),
      async () =>
        spawnOptions.sessionId
          ? await this.reattachForSpawn(spawnOptions)
          : await this.spawnFresh(spawnOptions)
    )
  }

  private spawnAdmissionLocator(
    spawnOptions: PtySpawnOptions
  ): TerminalAuthorityAppAdmissionLocator | null {
    if (!this.options.terminalAuthorityAppAdmission) {
      return null
    }
    if (spawnOptions.terminalSessionAuthorityAccess) {
      return { namespace: spawnOptions.terminalSessionAuthorityAccess.namespace }
    }
    if (spawnOptions.paneGeneration === undefined && !spawnOptions.agentSessionEnsure) {
      return null
    }
    if (!spawnOptions.worktreeId) {
      throw new Error('terminal_session_authority_workspace_required')
    }
    return { worktreeId: spawnOptions.worktreeId }
  }

  private async withTerminalAuthorityAdmission<T>(
    locator: TerminalAuthorityAppAdmissionLocator | null,
    operation: () => Promise<T>
  ): Promise<T> {
    const admission = this.options.terminalAuthorityAppAdmission
    if (!admission || !locator) {
      return await operation()
    }
    return await admission.withSourceAdmission(locator, async ({ assertCurrent }) => {
      assertCurrent()
      return await operation()
    })
  }

  async attach(id: string): Promise<void> {
    const relayPtyId = this.options.toRelayPtyId(id)
    const result = await requestSshPtyAttach({
      mux: this.options.mux,
      relayPtyId,
      params: { id: relayPtyId },
      commitSourceActivation: true,
      installSourceActivation: (ptyId, activation) =>
        this.options.outputState.installReceivingActivation(ptyId, activation),
      rememberPtyIncarnation: (ptyId, incarnationId) =>
        this.options.outputState.rememberPtyIncarnation(ptyId, incarnationId)
    })
    this.options.rememberAuthorityAccess(relayPtyId, result.terminalSessionAuthorityAccess)
    this.options.livePtyIds.markLifecycleTransition(id)
  }

  async attachForReconnect(
    id: string,
    expected?: SshPtyExpectedIdentity,
    sourceRecovery?: PtySourceRecoveryRequest
  ): Promise<SshPtyAttachResult> {
    const relayPtyId = this.options.toRelayPtyId(id)
    const expectedAccess = expected?.terminalSessionAuthorityAccess
    if (expectedAccess) {
      this.options.expectAuthorityAccess(relayPtyId, expectedAccess)
    }
    return await this.withTerminalAuthorityAdmission(
      expectedAccess ? { namespace: expectedAccess.namespace } : null,
      async () => {
        const result = await requestSshPtyAttach({
          mux: this.options.mux,
          relayPtyId,
          params: {
            id: relayPtyId,
            suppressReplayNotification: true,
            ...(sourceRecovery ? { sourceRecovery } : {}),
            ...(expected?.paneKey ? { expectedPaneKey: expected.paneKey } : {}),
            ...(expected?.tabId ? { expectedTabId: expected.tabId } : {}),
            ...buildSshTerminalAuthorityAttachRequest(expected)
          },
          timeoutMs: 10_000,
          installSourceActivation: (ptyId, activation) =>
            this.options.outputState.installReceivingActivation(ptyId, activation),
          rememberPtyIncarnation: (ptyId, incarnationId) =>
            this.options.outputState.rememberPtyIncarnation(ptyId, incarnationId)
        })
        if (
          expectedAccess &&
          (!result.terminalSessionAuthorityAccess ||
            !sameTerminalSessionAuthorityPtyAccess(
              expectedAccess,
              result.terminalSessionAuthorityAccess
            ))
        ) {
          throw new Error('ssh_terminal_authority_attach_access_mismatch')
        }
        this.options.rememberAuthorityAccess(relayPtyId, result.terminalSessionAuthorityAccess)
        this.options.livePtyIds.markLifecycleTransition(id)
        return result
      }
    )
  }

  private async reattachForSpawn(spawnOptions: PtySpawnOptions): Promise<PtySpawnResult> {
    let result: Awaited<ReturnType<typeof reattachSshPtySessionWithExitFence>> | undefined
    try {
      result = await reattachSshPtySessionWithExitFence({
        mux: this.options.mux,
        connectionId: this.options.connectionId,
        sessionId: spawnOptions.sessionId!,
        options: spawnOptions,
        exitRaceTracker: this.options.exitRaceTracker,
        installSourceActivation: (relayPtyId, activation) =>
          this.options.outputState.installReceivingActivation(relayPtyId, activation),
        rememberPtyIncarnation: (relayPtyId, incarnationId) =>
          this.options.outputState.rememberPtyIncarnation(relayPtyId, incarnationId)
      })
      if (result.sourceRecovery?.status === 'restoreRequired') {
        throw new Error(`${SSH_SESSION_EXPIRED_ERROR}: ${this.options.toRelayPtyId(result.id)}`)
      }
      this.options.livePtyIds.markLifecycleTransition(result.id)
      result.sourceActivationLease?.commit()
      const {
        sourceActivationLease: _lease,
        sourceRecovery: _sourceRecovery,
        ...spawnResult
      } = result
      this.options.rememberAuthorityAccess(
        this.options.toRelayPtyId(spawnResult.id),
        spawnResult.terminalSessionAuthorityAccess
      )
      return spawnResult
    } catch (error) {
      result?.sourceActivationLease?.rollback()
      throw error
    }
  }

  private async spawnFresh(spawnOptions: PtySpawnOptions): Promise<PtySpawnResult> {
    const supportsCreateOperation = spawnOptions.agentSessionCreateOperationId
      ? await this.options.capabilities.supportsCreateOperations({ signal: spawnOptions.signal })
      : false
    if (spawnOptions.signal?.aborted) {
      throw new Error('client_disconnected')
    }
    if (spawnOptions.agentSessionCreateOperationId && !supportsCreateOperation) {
      // Host routing owns legacy selection; a changed relay must not downgrade after dispatch.
      throw new Error('execution_owner_unavailable')
    }
    const result = await spawnFreshSshPty({
      mux: this.options.mux,
      options: spawnOptions,
      params: buildSshPtySpawnRequest({
        options: spawnOptions,
        remoteCliBridgeEnv: this.options.remoteCliBridgeEnv,
        supportsCreateOperation
      }),
      exitRaceTracker: this.options.exitRaceTracker,
      installSourceActivation: (id, activation) =>
        this.options.outputState.installReceivingActivation(id, activation),
      rememberPtyIncarnation: (id, incarnation) =>
        this.options.outputState.rememberPtyIncarnation(id, incarnation),
      acceptLivePty: (id) => this.options.livePtyIds.markLifecycleTransition(id),
      toAppPtyId: this.options.toAppPtyId
    })
    this.options.rememberAuthorityAccess(
      this.options.toRelayPtyId(result.id),
      result.terminalSessionAuthorityAccess
    )
    return result
  }
}
