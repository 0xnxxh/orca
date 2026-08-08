import type { Session } from './session'
import type { SessionInfo, TakePendingOutputResult, TerminalSnapshot } from './types'
import type { CreateOrAttachOptions, CreateOrAttachResult } from './terminal-host-create-contract'
import type { TerminalHostOptions } from './terminal-host-options'
import { TerminalSessionTeardown } from './terminal-session-teardown'
import { ClaimedAgentPtyOwnerRegistry } from '../../shared/claimed-agent-pty-owner'
import {
  createOrAttachClaimedAgentSession,
  type InternalCreateOrAttachOptions
} from './terminal-host-agent-session-claim'
import { TerminalHostAgentSessionGenerations } from './terminal-host-agent-session-generations'
import { TerminalHostTombstones } from './terminal-host-tombstones'
import {
  createOrAttachTerminalSession,
  type TerminalHostSessionCreationHooks
} from './terminal-host-session-create'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthoritySemanticFact } from '../../shared/terminal-session-authority-mutation'
import type { TerminalAuthorityBindingRetiredEffect } from '../session-authority/terminal-session-authority-host-effect-applier'
import { TerminalHostAuthoritySessions } from './terminal-host-authority-sessions'
import { TerminalHostPtyMutations } from './terminal-host-pty-mutations'
import { TerminalHostSessionQueries } from './terminal-host-session-queries'
import { disposeTerminalHostSessions } from './terminal-host-disposal'
import type { TerminalAuthorityPolicyConsumerConnection } from '../session-authority/terminal-session-authority-policy-consumers'

export type { CreateOrAttachOptions, CreateOrAttachResult } from './terminal-host-create-contract'
export type { TerminalHostOptions } from './terminal-host-options'

const DEFAULT_MAX_TOMBSTONES = 1000

export class TerminalHost {
  private sessions = new Map<string, Session>()
  private sessionTeardown = new TerminalSessionTeardown(this.sessions)
  private killedTombstones: TerminalHostTombstones
  private spawnSubprocess: TerminalHostOptions['spawnSubprocess']
  private onSessionReaped: TerminalHostOptions['onSessionReaped']
  private onFinalCheckpoint: TerminalHostOptions['onFinalCheckpoint']
  private maxTombstones: number
  private creationFenced = false
  private disposePromise: Promise<void> | null = null
  private readonly agentSessionOwners = new ClaimedAgentPtyOwnerRegistry()
  private readonly agentSessionGenerations = new TerminalHostAgentSessionGenerations()
  private readonly authoritySessions: TerminalHostAuthoritySessions
  private readonly mutations: TerminalHostPtyMutations
  private readonly queries: TerminalHostSessionQueries

  constructor(opts: TerminalHostOptions) {
    this.spawnSubprocess = opts.spawnSubprocess
    this.onSessionReaped = opts.onSessionReaped
    this.onFinalCheckpoint = opts.onFinalCheckpoint
    this.maxTombstones = opts.maxTombstones ?? DEFAULT_MAX_TOMBSTONES
    this.killedTombstones = new TerminalHostTombstones(this.maxTombstones)
    this.authoritySessions = new TerminalHostAuthoritySessions(
      opts.terminalSessionAuthority,
      opts.onTerminalSessionAuthorityFailure,
      {
        sessions: this.sessions,
        createPhysical: (options, hooks) => this.createOrAttachPhysicalSession(options, hooks),
        releaseExited: (sessionId, generation) => this.releaseExitedSession(sessionId, generation),
        fenceCreation: () => {
          this.creationFenced = true
        }
      }
    )
    this.mutations = new TerminalHostPtyMutations(
      this.sessions,
      this.sessionTeardown,
      this.killedTombstones,
      this.authoritySessions
    )
    this.queries = new TerminalHostSessionQueries(
      this.sessions,
      this.agentSessionOwners,
      this.authoritySessions,
      this.killedTombstones,
      (sessionId) => this.mutations.alive(sessionId)
    )
  }

  async createOrAttach(opts: CreateOrAttachOptions): Promise<CreateOrAttachResult> {
    return await this.authoritySessions.enqueue(opts.sessionId, async () =>
      createOrAttachClaimedAgentSession({
        options: opts,
        owners: this.agentSessionOwners,
        isLive: (owner) =>
          this.agentSessionGenerations.isCurrent(
            owner,
            Boolean(this.sessions.get(owner.ptyId)?.isAlive)
          ),
        createOrAttach: (options) => this.authoritySessions.createOrAttach(options)
      })
    )
  }

  private async createOrAttachPhysicalSession(
    options: InternalCreateOrAttachOptions,
    creationHooks?: TerminalHostSessionCreationHooks
  ): Promise<CreateOrAttachResult> {
    if (options.agentSessionGeneration && this.sessions.get(options.sessionId)?.isAlive) {
      throw new Error('agent_session_claim_unavailable')
    }
    return await createOrAttachTerminalSession(options, {
      sessions: this.sessions,
      sessionTeardown: this.sessionTeardown,
      killedTombstones: this.killedTombstones,
      spawnSubprocess: this.spawnSubprocess,
      creationFenced: this.creationFenced,
      onDeadSessionRemoved: (sessionId) => this.agentSessionGenerations.forget(sessionId),
      onSessionCreated: (sessionId, generation, isAlive) =>
        this.agentSessionGenerations.remember(sessionId, generation, isAlive),
      onSessionExit: (sessionId, generation, code) =>
        this.authoritySessions.handleExit(sessionId, generation, code),
      ...(creationHooks ? { creationHooks } : {})
    })
  }

  private releaseExitedSession(sessionId: string, generation: string | undefined): void {
    this.agentSessionOwners.release(sessionId, generation)
    this.agentSessionGenerations.forget(sessionId, generation)
    this.reapSession(sessionId)
  }

  async recordSemanticOutcomeExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    fact: TerminalSessionAuthoritySemanticFact
  ): Promise<boolean> {
    return await this.authoritySessions.recordSemanticOutcomeExact(sessionId, access, fact)
  }

  write(sessionId: string, data: string): void {
    this.mutations.write(sessionId, data)
  }

  writeExact(sessionId: string, incarnationId: string, data: string): boolean {
    return this.mutations.writeExact(sessionId, incarnationId, data)
  }

  writeAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    data: string
  ): boolean {
    return this.mutations.writeAuthorityExact(sessionId, access, data)
  }

  closeStartupQueryAuthority(sessionId: string): number {
    return this.mutations.alive(sessionId).closeStartupQueryAuthority()
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.mutations.resize(sessionId, cols, rows)
  }

  resizeExact(sessionId: string, incarnationId: string, cols: number, rows: number): boolean {
    return this.mutations.resizeExact(sessionId, incarnationId, cols, rows)
  }

  resizeAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    cols: number,
    rows: number
  ): boolean {
    return this.mutations.resizeAuthorityExact(sessionId, access, cols, rows)
  }

  // Why null-not-throw (unlike write/resize): pause/resume are best-effort hints against a session that may have exited.
  pauseProducer(sessionId: string): void {
    this.mutations.pauseProducer(sessionId)
  }

  resumeProducer(sessionId: string): void {
    this.mutations.resumeProducer(sessionId)
  }

  supportsExactHeldProducerPause(sessionId: string, incarnationId: string): boolean {
    return this.mutations.supportsExactHeldProducerPause(sessionId, incarnationId)
  }

  acquireExactHeldProducerPause(
    sessionId: string,
    incarnationId: string,
    ownerId: string,
    token: string
  ): boolean {
    return this.mutations.acquireExactHeldProducerPause(sessionId, incarnationId, ownerId, token)
  }

  releaseExactHeldProducerPause(
    sessionId: string,
    incarnationId: string,
    ownerId: string,
    token: string
  ): boolean {
    return this.mutations.releaseExactHeldProducerPause(sessionId, incarnationId, ownerId, token)
  }

  releaseExactHeldProducerPauses(sessionId: string, incarnationId: string, ownerId: string): void {
    this.mutations.releaseExactHeldProducerPauses(sessionId, incarnationId, ownerId)
  }

  kill(sessionId: string, opts: { immediate?: boolean } = {}): Promise<void> {
    return this.mutations.kill(sessionId, opts)
  }

  async killExact(
    sessionId: string,
    incarnationId: string,
    opts: { immediate?: boolean } = {}
  ): Promise<boolean> {
    return await this.mutations.killExact(sessionId, incarnationId, opts)
  }

  async killAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    opts: { immediate?: boolean } = {}
  ): Promise<boolean> {
    return await this.mutations.killAuthorityExact(sessionId, access, policyConsumer, opts)
  }

  ensureAuthorityBindingRetired(
    access: TerminalSessionAuthorityPtyAccess,
    reason: TerminalAuthorityBindingRetiredEffect['reason']
  ): Promise<void> {
    return this.mutations.ensureAuthorityBindingRetired(access, reason)
  }

  // Why: dispose a dead session's emulator so exited terminals don't pin ~5000 rows of scrollback for the daemon's life.
  private reapSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.isAlive) {
      return
    }
    session.dispose()
    this.sessions.delete(sessionId)
    this.onSessionReaped?.(sessionId)
  }

  signal(sessionId: string, sig: string): void {
    this.mutations.signal(sessionId, sig)
  }

  signalExact(sessionId: string, incarnationId: string, sig: string): boolean {
    return this.mutations.signalExact(sessionId, incarnationId, sig)
  }

  signalAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    sig: string
  ): boolean {
    return this.mutations.signalAuthorityExact(sessionId, access, sig)
  }

  detach(sessionId: string, token: symbol): void {
    this.queries.detach(sessionId, token)
  }

  async getCwd(sessionId: string): Promise<string | null> {
    return await this.queries.getCwd(sessionId)
  }

  // Why: null-not-throw — fetched for the tab-bar icon, so a vanished pane should quietly yield "no agent".
  getForegroundProcess(sessionId: string): string | null {
    return this.queries.getForegroundProcess(sessionId)
  }

  inspectProcess(sessionId: string): {
    foregroundProcess: string | null
    hasChildProcesses: boolean
  } {
    return this.queries.inspectProcess(sessionId)
  }

  async confirmForegroundProcess(sessionId: string): Promise<string | null> {
    return await this.queries.confirmForegroundProcess(sessionId)
  }

  clearScrollback(sessionId: string): void {
    this.mutations.clearScrollback(sessionId)
  }

  clearScrollbackExact(sessionId: string, incarnationId: string): boolean {
    return this.mutations.clearScrollbackExact(sessionId, incarnationId)
  }

  clearScrollbackAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess
  ): boolean {
    return this.mutations.clearScrollbackAuthorityExact(sessionId, access)
  }

  // Why: null-not-throw (unlike getAliveSession) — checkpoint is best-effort against a session that may have just exited.
  getSnapshot(sessionId: string, opts: { scrollbackRows?: number } = {}): TerminalSnapshot | null {
    return this.queries.getSnapshot(sessionId, opts)
  }

  // Why: scan-authority handoff seed (null-not-throw like getSnapshot) — emulator's dangling incomplete escape at the stream position.
  getPartialEscapeTailAnsi(sessionId: string): string {
    return this.queries.getPartialEscapeTailAnsi(sessionId)
  }

  // Why: renderer diffs this against xterm to detect a dropped/coerced daemon-side resize; null-not-throw like getSnapshot.
  getAppliedSize(sessionId: string): { cols: number; rows: number } | null {
    return this.queries.getAppliedSize(sessionId)
  }

  // Why: null-not-throw like getSnapshot — incremental checkpoints are best-effort against a just-exited session.
  takePendingOutput(
    sessionId: string,
    includeSnapshot: boolean,
    opts: { teardownSnapshot?: boolean } = {}
  ): TakePendingOutputResult | null {
    return this.queries.takePendingOutput(sessionId, includeSnapshot, opts)
  }

  isKilled(sessionId: string): boolean {
    return this.queries.isKilled(sessionId)
  }

  listSessions(): SessionInfo[] {
    return this.queries.listSessions()
  }

  dispose(): Promise<void> {
    this.creationFenced = true
    if (this.disposePromise) {
      return this.disposePromise
    }
    const disposePromise = this.disposeSessions()
    this.disposePromise = disposePromise
    void disposePromise.catch(() => {
      // Why: keep failed native owners retryable on a later shutdown request.
      if (this.disposePromise === disposePromise) {
        this.disposePromise = null
      }
    })
    return disposePromise
  }

  private async disposeSessions(): Promise<void> {
    await disposeTerminalHostSessions({
      sessions: this.sessions,
      authoritySessions: this.authoritySessions,
      killedTombstones: this.killedTombstones,
      onFinalCheckpoint: this.onFinalCheckpoint
    })
  }
}
