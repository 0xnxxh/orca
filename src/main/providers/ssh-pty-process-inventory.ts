import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { mapSshPtyProcessList } from './ssh-agent-session-process-list'
import type { SshPtyAuthorityRouting } from './ssh-pty-authority-routing'
import type { SshPtyLiveMembership } from './ssh-pty-live-membership'
import type { SshPtyProviderOutputState } from './ssh-pty-provider-output-state'
import { sshRelayDeadlineOptions } from './ssh-relay-request-deadline'
import type { PtyProcessInfo } from './types'

type SshPtyProcessInventoryOptions = Readonly<{
  mux: SshChannelMultiplexer
  livePtyIds: SshPtyLiveMembership
  outputState: SshPtyProviderOutputState
  authorityRouting: SshPtyAuthorityRouting
  toAppPtyId: (id: string) => string
  toRelayPtyId: (id: string) => string
}>

export class SshPtyProcessInventory {
  private requestGeneration = 0

  constructor(private readonly options: SshPtyProcessInventoryOptions) {}

  async list(deadlineMs?: number): Promise<PtyProcessInfo[]> {
    const requestGeneration = ++this.requestGeneration
    const membershipRevision = this.options.livePtyIds.captureRevision()
    const result = await this.options.mux.request(
      'pty.listProcesses',
      undefined,
      sshRelayDeadlineOptions(deadlineMs)
    )
    if (requestGeneration !== this.requestGeneration) {
      throw new Error('ssh_pty_process_inventory_unavailable')
    }
    const processes = mapSshPtyProcessList(result as PtyProcessInfo[], this.options.toAppPtyId)
    const admittedProcesses: PtyProcessInfo[] = []
    const admittedIds = new Set<string>()
    for (const process of processes) {
      if (!this.options.livePtyIds.changedAfter(process.id, membershipRevision)) {
        this.admit(process)
        admittedIds.add(process.id)
        admittedProcesses.push(process)
      }
    }
    this.reconcileAbsent(admittedIds, membershipRevision)
    return admittedProcesses
  }

  private admit(process: PtyProcessInfo): void {
    const relayPtyId = this.options.toRelayPtyId(process.id)
    const currentIncarnationId = this.options.outputState.getPtyIncarnation(relayPtyId)
    if (
      currentIncarnationId &&
      process.incarnationId &&
      currentIncarnationId !== process.incarnationId
    ) {
      throw new Error('ssh_pty_process_list_incarnation_conflict')
    }
    const mutationRouteToken = this.options.authorityRouting.markListedProcess(
      process.id,
      process.terminalSessionAuthorityAccess,
      process.incarnationId ?? currentIncarnationId
    )
    this.options.livePtyIds.add(process.id)
    this.options.outputState.rememberPtyIncarnation(relayPtyId, process.incarnationId)
    if (mutationRouteToken) {
      process.mutationRouteToken = mutationRouteToken
    }
  }

  private reconcileAbsent(admittedIds: ReadonlySet<string>, membershipRevision: number): void {
    for (const id of this.options.livePtyIds) {
      if (admittedIds.has(id) || this.options.livePtyIds.changedAfter(id, membershipRevision)) {
        continue
      }
      this.options.livePtyIds.delete(id)
      const relayPtyId = this.options.toRelayPtyId(id)
      this.options.outputState.forgetPtyIncarnation(relayPtyId)
      this.options.authorityRouting.recordExit(relayPtyId)
    }
  }
}
