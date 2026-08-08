import type { Session } from './session'
import {
  createOrAttachRequestsTerminalSessionAuthority,
  type CreateOrAttachResult
} from './terminal-host-create-contract'
import type { InternalCreateOrAttachOptions } from './terminal-host-agent-session-claim'
import type { TerminalHostSessionCreationHooks } from './terminal-host-session-create'
import type { TerminalHostOptions } from './terminal-host-options'
import {
  parseTerminalSessionAuthorityPtyAccess,
  sameTerminalSessionAuthorityPtyAccess,
  type TerminalSessionAuthorityPtyAccess
} from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthoritySemanticFact } from '../../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityPreparedPtySpawn } from '../session-authority/terminal-session-authority-pty-binding'
import { TerminalHostAuthoritySemanticRecorder } from './terminal-host-authority-semantic-recorder'
import { TerminalHostAuthorityRequestQueue } from './terminal-host-authority-request-queue'
import { spawnTerminalHostAuthoritySession } from './terminal-host-authority-spawn'
import {
  authorityTerminalStreamClient,
  requireTerminalHostAuthorityConsumerSource
} from './terminal-host-authority-consumer-routing'
import {
  terminalAuthorityPolicyConsumerForNamespace,
  type TerminalAuthorityPolicyConsumerConnection
} from '../session-authority/terminal-session-authority-policy-consumers'

type AuthorityOptions = NonNullable<TerminalHostOptions['terminalSessionAuthority']>

export type TerminalHostAuthoritySessionDependencies = Readonly<{
  sessions: ReadonlyMap<string, Session>
  createPhysical(
    options: InternalCreateOrAttachOptions,
    creationHooks?: TerminalHostSessionCreationHooks
  ): Promise<CreateOrAttachResult>
  releaseExited(sessionId: string, generation: string | undefined): void
  fenceCreation(): void
}>

export class TerminalHostAuthoritySessions {
  private readonly ptyOwner: AuthorityOptions['ptyOwner'] | null
  private readonly accessBySession = new Map<string, TerminalSessionAuthorityPtyAccess>()
  private readonly exitFinalizations = new Set<Promise<void>>()
  private readonly pendingSessions = new Set<Session>()
  private readonly requestQueue = new TerminalHostAuthorityRequestQueue()
  private readonly semanticRecorder: TerminalHostAuthoritySemanticRecorder
  private failure: Error | null = null

  constructor(
    options: TerminalHostOptions['terminalSessionAuthority'],
    private readonly onFailure: ((error: Error) => void) | undefined,
    private readonly deps: TerminalHostAuthoritySessionDependencies
  ) {
    this.ptyOwner = options?.ptyOwner ?? null
    this.semanticRecorder = new TerminalHostAuthoritySemanticRecorder(
      deps.sessions,
      this.ptyOwner,
      (sessionId) => this.accessFor(sessionId),
      (error) => this.fail(error)
    )
  }

  enqueue<T>(sessionId: string, request: () => Promise<T>): Promise<T> {
    return this.requestQueue.enqueue(sessionId, request)
  }

  async createOrAttach(options: InternalCreateOrAttachOptions): Promise<CreateOrAttachResult> {
    const authorityRequested = createOrAttachRequestsTerminalSessionAuthority(options)
    if (authorityRequested && options.terminalSessionAuthorityNegotiated !== true) {
      throw new Error('terminal_session_authority_unavailable')
    }
    if (!this.ptyOwner) {
      if (authorityRequested) {
        throw new Error('terminal_session_authority_unavailable')
      }
      options.streamClient.onAuthorityAccess?.(null)
      return await this.deps.createPhysical(options)
    }
    const suppliedAccess = this.parseSuppliedAccess(options)
    if (suppliedAccess) {
      return await this.attach(options, suppliedAccess)
    }
    if (
      options.terminalSessionAuthorityVersion !== undefined ||
      options.terminalSessionAuthorityOperationId !== undefined
    ) {
      return await this.createOrAdopt(options)
    }
    if (this.accessFor(options.sessionId)) {
      throw new Error('terminal_session_authority_access_required')
    }
    options.streamClient.onAuthorityAccess?.(null)
    return await this.deps.createPhysical(options)
  }

  accessFor(sessionId: string): TerminalSessionAuthorityPtyAccess | null {
    return this.accessBySession.get(sessionId) ?? this.ptyOwner?.accessFor(sessionId) ?? null
  }

  exactSession(sessionId: string, access: TerminalSessionAuthorityPtyAccess): Session | null {
    const parsed = parseTerminalSessionAuthorityPtyAccess(access)
    const session = this.deps.sessions.get(sessionId)
    if (
      !parsed ||
      !session?.isAlive ||
      parsed.binding.physicalPtyId !== sessionId ||
      parsed.binding.ptyIncarnationId !== session.incarnationId ||
      !sameTerminalSessionAuthorityPtyAccess(this.accessFor(sessionId), parsed) ||
      !this.ptyOwner?.admits(sessionId, parsed)
    ) {
      return null
    }
    return session
  }

  exactRememberedSession(access: TerminalSessionAuthorityPtyAccess): Session | null {
    const sessionId = access.binding.physicalPtyId
    const remembered = this.accessBySession.get(sessionId)
    const session = this.deps.sessions.get(sessionId)
    return remembered &&
      session?.isAlive &&
      session.incarnationId === access.binding.ptyIncarnationId &&
      sameTerminalSessionAuthorityPtyAccess(remembered, access)
      ? session
      : null
  }

  async closeExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection
  ): Promise<boolean> {
    if (!this.exactSession(sessionId, access)) {
      return false
    }
    try {
      return await this.ptyOwner!.close(sessionId, access, policyConsumer)
    } catch (error) {
      this.fail(error)
      throw error
    }
  }

  async recordSemanticOutcomeExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    fact: TerminalSessionAuthoritySemanticFact
  ): Promise<boolean> {
    return await this.semanticRecorder.recordExact(sessionId, access, fact)
  }

  handleExit(sessionId: string, generation: string | undefined, code: number): void {
    const access = this.accessFor(sessionId)
    if (!access) {
      this.deps.releaseExited(sessionId, generation)
      return
    }
    const finalization = this.finalizeExit(sessionId, generation, access, code)
    this.exitFinalizations.add(finalization)
    void finalization.then(
      () => this.exitFinalizations.delete(finalization),
      (error) => {
        this.exitFinalizations.delete(finalization)
        this.fail(error)
      }
    )
  }

  requestSettlement(): Promise<void> | null {
    return this.requestQueue.settlement()
  }

  unpublishedSessions(): readonly Session[] {
    return [...this.pendingSessions].filter((session) => !this.deps.sessions.has(session.sessionId))
  }

  async finishDispose(): Promise<void> {
    await Promise.all(this.exitFinalizations)
    if (this.failure) {
      throw this.failure
    }
    this.accessBySession.clear()
    this.pendingSessions.clear()
  }

  private parseSuppliedAccess(
    options: InternalCreateOrAttachOptions
  ): TerminalSessionAuthorityPtyAccess | null {
    const supplied = options.terminalSessionAuthorityAccess
    const parsed = supplied === undefined ? null : parseTerminalSessionAuthorityPtyAccess(supplied)
    if (supplied !== undefined && !parsed) {
      throw new Error('terminal_session_authority_access_invalid')
    }
    return parsed
  }

  private async createOrAdopt(
    options: InternalCreateOrAttachOptions
  ): Promise<CreateOrAttachResult> {
    const existing = this.deps.sessions.get(options.sessionId)
    if (existing?.isAlive && !this.accessFor(options.sessionId)) {
      throw new Error('terminal_session_authority_binding_required')
    }
    const policyConsumer = requireTerminalHostAuthorityConsumerSource(
      options,
      this.ptyOwner !== null
    )
    const preparation = await this.ptyOwner!.prepareSpawn(
      options,
      options.sessionId,
      policyConsumer,
      options.terminalSessionAuthorityOperationId
    )
    if (preparation.kind === 'spawn') {
      return await this.spawn(options, preparation.prepared)
    }
    const { binding } = preparation.adopted
    if (binding.physicalPtyId !== options.sessionId) {
      throw new Error('terminal_session_authority_adopted_pty_mismatch')
    }
    const access = this.ptyOwner!.adopt(
      preparation.adopted,
      binding.physicalPtyId,
      binding.ptyIncarnationId
    )
    if (!access) {
      throw new Error('terminal_session_authority_live_binding_missing')
    }
    return await this.attach(options, access)
  }

  private async attach(
    options: InternalCreateOrAttachOptions,
    access: TerminalSessionAuthorityPtyAccess
  ): Promise<CreateOrAttachResult> {
    const policyConsumer = terminalAuthorityPolicyConsumerForNamespace(
      requireTerminalHostAuthorityConsumerSource(options, this.ptyOwner !== null),
      access.namespace
    )
    policyConsumer.assertInstalled(access.namespace)
    if (
      access.binding.physicalPtyId !== options.sessionId ||
      !this.ptyOwner!.admits(options.sessionId, access)
    ) {
      throw new Error('terminal_session_authority_access_rejected')
    }
    options.streamClient.onAuthorityAccess?.(access)
    const result = await this.deps.createPhysical({
      ...options,
      attachOnly: true,
      streamClient: authorityTerminalStreamClient(options, this.ptyOwner !== null)
    })
    if (result.incarnationId !== access.binding.ptyIncarnationId) {
      throw new Error('terminal_session_authority_incarnation_mismatch')
    }
    this.accessBySession.set(options.sessionId, access)
    return { ...result, terminalSessionAuthorityAccess: access }
  }

  private async spawn(
    options: InternalCreateOrAttachOptions,
    prepared: TerminalAuthorityPreparedPtySpawn
  ): Promise<CreateOrAttachResult> {
    return await spawnTerminalHostAuthoritySession({
      options,
      prepared,
      ptyOwner: this.ptyOwner!,
      dependencies: this.deps,
      accessBySession: this.accessBySession,
      pendingSessions: this.pendingSessions,
      fail: (error) => this.fail(error)
    })
  }

  private async finalizeExit(
    sessionId: string,
    generation: string | undefined,
    access: TerminalSessionAuthorityPtyAccess,
    code: number
  ): Promise<void> {
    await this.ptyOwner!.recordExit(sessionId, access.binding.ptyIncarnationId, code)
    if (!sameTerminalSessionAuthorityPtyAccess(this.accessFor(sessionId), access)) {
      return
    }
    this.accessBySession.delete(sessionId)
    this.deps.releaseExited(sessionId, generation)
  }

  private fail(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error))
    this.deps.fenceCreation()
    this.failure ??= normalized
    this.onFailure?.(normalized)
  }
}
