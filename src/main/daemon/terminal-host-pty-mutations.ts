import { SessionNotFoundError } from './types'
import type { Session } from './session'
import type { TerminalSessionTeardown } from './terminal-session-teardown'
import type { TerminalHostTombstones } from './terminal-host-tombstones'
import type { TerminalHostAuthoritySessions } from './terminal-host-authority-sessions'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalAuthorityBindingRetiredEffect } from '../session-authority/terminal-session-authority-host-effect-applier'
import type { TerminalAuthorityPolicyConsumerConnection } from '../session-authority/terminal-session-authority-policy-consumers'

type KillOptions = { immediate?: boolean }

export class TerminalHostPtyMutations {
  constructor(
    private readonly sessions: ReadonlyMap<string, Session>,
    private readonly teardown: TerminalSessionTeardown,
    private readonly tombstones: TerminalHostTombstones,
    private readonly authority: TerminalHostAuthoritySessions
  ) {}

  alive(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session || !session.isAlive) {
      throw new SessionNotFoundError(sessionId)
    }
    return session
  }

  write(sessionId: string, data: string): void {
    this.mutable(sessionId).write(data)
  }

  writeExact(sessionId: string, incarnationId: string, data: string): boolean {
    const session = this.legacyExact(sessionId, incarnationId)
    if (!session) {
      return false
    }
    session.write(data)
    return true
  }

  writeAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    data: string
  ): boolean {
    const session = this.authority.exactSession(sessionId, access)
    if (!session) {
      return false
    }
    session.write(data)
    return true
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.mutable(sessionId).resize(cols, rows)
  }

  resizeExact(sessionId: string, incarnationId: string, cols: number, rows: number): boolean {
    const session = this.legacyExact(sessionId, incarnationId)
    if (!session) {
      return false
    }
    session.resize(cols, rows)
    return true
  }

  resizeAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    cols: number,
    rows: number
  ): boolean {
    const session = this.authority.exactSession(sessionId, access)
    if (!session) {
      return false
    }
    session.resize(cols, rows)
    return true
  }

  pauseProducer(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session?.isAlive) {
      session.pauseProducer()
    }
  }

  resumeProducer(sessionId: string): void {
    this.sessions.get(sessionId)?.resumeProducer()
  }

  supportsExactHeldProducerPause(sessionId: string, incarnationId: string): boolean {
    const session = this.sessions.get(sessionId)
    return Boolean(
      session?.isAlive &&
      session.incarnationId === incarnationId &&
      session.supportsExactHeldProducerPause()
    )
  }

  acquireExactHeldProducerPause(
    sessionId: string,
    incarnationId: string,
    ownerId: string,
    token: string
  ): boolean {
    const session = this.sessions.get(sessionId)
    return Boolean(
      session?.isAlive &&
      session.incarnationId === incarnationId &&
      session.acquireExactHeldProducerPause(ownerId, token)
    )
  }

  releaseExactHeldProducerPause(
    sessionId: string,
    incarnationId: string,
    ownerId: string,
    token: string
  ): boolean {
    const session = this.sessions.get(sessionId)
    return Boolean(
      session?.isAlive &&
      session.incarnationId === incarnationId &&
      session.releaseExactHeldProducerPause(ownerId, token)
    )
  }

  releaseExactHeldProducerPauses(sessionId: string, incarnationId: string, ownerId: string): void {
    const session = this.sessions.get(sessionId)
    if (session?.isAlive && session.incarnationId === incarnationId) {
      session.releaseExactHeldProducerPauses(ownerId)
    }
  }

  kill(sessionId: string, options: KillOptions = {}): Promise<void> {
    if (this.authority.accessFor(sessionId)) {
      throw new SessionNotFoundError(sessionId)
    }
    if (!this.teardown.get(sessionId)) {
      this.alive(sessionId)
    }
    return this.killOwned(sessionId, options)
  }

  async killExact(
    sessionId: string,
    incarnationId: string,
    options: KillOptions = {}
  ): Promise<boolean> {
    if (!this.legacyExact(sessionId, incarnationId)) {
      return false
    }
    await this.killOwned(sessionId, options)
    return true
  }

  async killAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    policyConsumer: TerminalAuthorityPolicyConsumerConnection,
    options: KillOptions = {}
  ): Promise<boolean> {
    if (!(await this.authority.closeExact(sessionId, access, policyConsumer))) {
      return false
    }
    await this.killOwned(sessionId, options)
    return true
  }

  async ensureAuthorityBindingRetired(
    access: TerminalSessionAuthorityPtyAccess,
    reason: TerminalAuthorityBindingRetiredEffect['reason']
  ): Promise<void> {
    if (reason === 'exit') {
      return
    }
    const session = this.authority.exactRememberedSession(access)
    if (!session) {
      throw new Error('terminal_session_authority_physical_shutdown_pending')
    }
    await this.killOwned(session.sessionId, { immediate: true })
  }

  signal(sessionId: string, signal: string): void {
    this.mutable(sessionId).signal(signal)
  }

  signalExact(sessionId: string, incarnationId: string, signal: string): boolean {
    const session = this.legacyExact(sessionId, incarnationId)
    if (!session) {
      return false
    }
    session.signal(signal)
    return true
  }

  signalAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess,
    signal: string
  ): boolean {
    const session = this.authority.exactSession(sessionId, access)
    if (!session) {
      return false
    }
    session.signal(signal)
    return true
  }

  clearScrollback(sessionId: string): void {
    this.mutable(sessionId).clearScrollback()
  }

  clearScrollbackExact(sessionId: string, incarnationId: string): boolean {
    const session = this.legacyExact(sessionId, incarnationId)
    if (!session) {
      return false
    }
    session.clearScrollback()
    return true
  }

  clearScrollbackAuthorityExact(
    sessionId: string,
    access: TerminalSessionAuthorityPtyAccess
  ): boolean {
    const session = this.authority.exactSession(sessionId, access)
    if (!session) {
      return false
    }
    session.clearScrollback()
    return true
  }

  private mutable(sessionId: string): Session {
    const session = this.alive(sessionId)
    if (this.authority.accessFor(sessionId)) {
      throw new SessionNotFoundError(sessionId)
    }
    return session
  }

  private legacyExact(sessionId: string, incarnationId: string): Session | null {
    const session = this.sessions.get(sessionId)
    if (
      !session?.isAlive ||
      session.incarnationId !== incarnationId ||
      this.authority.accessFor(sessionId)
    ) {
      return null
    }
    return session
  }

  private killOwned(sessionId: string, options: KillOptions): Promise<void> {
    const pending = this.teardown.get(sessionId)
    if (pending) {
      return Promise.resolve(
        options.immediate ? this.teardown.requestImmediate(sessionId) : pending
      )
    }
    const killed = this.teardown.killSession(
      sessionId,
      this.alive(sessionId),
      options.immediate === true
    )
    this.tombstones.record(sessionId)
    return Promise.resolve(killed)
  }
}
