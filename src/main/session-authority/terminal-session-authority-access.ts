import { assertAuthorityId } from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'

export type TerminalAuthorityWriterAccess = Readonly<{
  role: 'writer'
  serviceInstanceId: string
  actorId: string
  ownerToken: string
  writerEpoch: number
}>

export type TerminalAuthorityConsumerAccess = Readonly<{
  role: 'consumer'
  serviceInstanceId: string
  consumerId: string
  consumerIncarnationId: string
}>

export type TerminalAuthorityObserverAccess = Readonly<{
  role: 'observer'
  serviceInstanceId: string
  accessId: string
  actorId: string
}>

export class TerminalAuthorityRuntimeAccess {
  private readonly observers = new Map<string, TerminalAuthorityObserverAccess>()

  constructor(
    private readonly serviceInstanceId: string,
    readonly writer: TerminalAuthorityWriterAccess,
    private readonly createId: () => string,
    private readonly maxObservers: number
  ) {}

  assertWriter(access: TerminalAuthorityWriterAccess): void {
    if (
      access.role !== 'writer' ||
      access.serviceInstanceId !== this.serviceInstanceId ||
      access.actorId !== this.writer.actorId ||
      access.ownerToken !== this.writer.ownerToken ||
      access.writerEpoch !== this.writer.writerEpoch
    ) {
      failTerminalSessionAuthority('writer-fenced', 'authority writer access is stale')
    }
  }

  assertBindingAuthorityReader(
    access: TerminalAuthorityWriterAccess | TerminalAuthorityObserverAccess
  ): void {
    if (access.role === 'writer') {
      this.assertWriter(access)
      return
    }
    this.assertObserver(access)
  }

  consumer(consumerId: string, consumerIncarnationId: string): TerminalAuthorityConsumerAccess {
    return Object.freeze({
      role: 'consumer',
      serviceInstanceId: this.serviceInstanceId,
      consumerId,
      consumerIncarnationId
    })
  }

  assertConsumerService(access: TerminalAuthorityConsumerAccess): void {
    if (access.role !== 'consumer' || access.serviceInstanceId !== this.serviceInstanceId) {
      failTerminalSessionAuthority(
        'consumer-conflict',
        'consumer access belongs to another service'
      )
    }
  }

  observe(actorId: string): TerminalAuthorityObserverAccess {
    assertAuthorityId(actorId, 'observer actorId')
    if (this.observers.size >= this.maxObservers) {
      failTerminalSessionAuthority('capacity', 'authority observers are full')
    }
    const accessId = this.createId()
    assertAuthorityId(accessId, 'authority access ID')
    if (this.observers.has(accessId)) {
      failTerminalSessionAuthority('operation-conflict', 'authority access ID was reused')
    }
    const access = Object.freeze({
      role: 'observer' as const,
      serviceInstanceId: this.serviceInstanceId,
      accessId,
      actorId
    })
    this.observers.set(accessId, access)
    return access
  }

  revokeObserver(access: TerminalAuthorityObserverAccess): void {
    this.assertObserver(access)
    this.observers.delete(access.accessId)
  }

  assertObserver(access: TerminalAuthorityObserverAccess): void {
    const registered = this.observers.get(access.accessId)
    if (
      !registered ||
      registered.serviceInstanceId !== access.serviceInstanceId ||
      registered.actorId !== access.actorId
    ) {
      failTerminalSessionAuthority('writer-fenced', 'observer access is revoked')
    }
  }

  clear(): void {
    this.observers.clear()
  }
}
