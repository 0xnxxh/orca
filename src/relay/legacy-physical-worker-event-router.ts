import type { PtySourceSpan } from '../shared/pty-source-credit-contract'
import type { LegacyPhysicalWorkerClient } from './legacy-physical-worker-client'
import type { ImportedPhysicalWorkerPtySession } from './legacy-physical-worker-authority-session'
import {
  parseLegacyPhysicalWorkerExit,
  parseLegacyPhysicalWorkerSourceSpan
} from './legacy-physical-worker-source-event'

const MAX_PENDING_WORKER_EVENTS = 128
const MAX_PENDING_WORKER_EVENT_BYTES = 2 * 1024 * 1024

type BufferedWorkerEvent = Readonly<{
  method: string
  params: Record<string, unknown>
  bytes: number
}>

type WorkerSubscription = {
  removeNotification: () => void
  pending: BufferedWorkerEvent[]
  pendingBytes: number
}

export class LegacyPhysicalWorkerEventRouter {
  private readonly subscriptions = new Map<LegacyPhysicalWorkerClient, WorkerSubscription>()
  private readonly sessionsByClient = new Map<
    LegacyPhysicalWorkerClient,
    Map<string, ImportedPhysicalWorkerPtySession>
  >()

  constructor(
    private readonly reportWorkerFault: (error: Error) => void,
    private readonly acceptExit: (
      session: ImportedPhysicalWorkerPtySession,
      exit: ReturnType<typeof parseLegacyPhysicalWorkerExit>
    ) => void = (session, exit) => {
      session.proxy.acceptExit(exit)
    }
  ) {}

  ensureSubscription(client: LegacyPhysicalWorkerClient): void {
    if (this.subscriptions.has(client)) {
      return
    }
    const subscription: WorkerSubscription = {
      removeNotification: () => {},
      pending: [],
      pendingBytes: 0
    }
    subscription.removeNotification = client.onNotification((method, params) => {
      this.accept(client, method, params, subscription)
    })
    this.subscriptions.set(client, subscription)
  }

  registerSession(session: ImportedPhysicalWorkerPtySession): void {
    const sessions = this.sessionsByClient.get(session.client) ?? new Map()
    const routeKey = workerEventRouteKey({
      id: session.binding.physicalPtyId,
      incarnationId: session.binding.ptyIncarnationId
    })
    const current = sessions.get(routeKey)
    if (current && current !== session) {
      throw new Error('legacy physical worker event route is already registered')
    }
    sessions.set(routeKey, session)
    this.sessionsByClient.set(session.client, sessions)
    this.drain(session.client)
  }

  unregisterSession(session: ImportedPhysicalWorkerPtySession): void {
    const sessions = this.sessionsByClient.get(session.client)
    if (!sessions) {
      return
    }
    const routeKey = workerEventRouteKey({
      id: session.binding.physicalPtyId,
      incarnationId: session.binding.ptyIncarnationId
    })
    if (sessions.get(routeKey) === session) {
      sessions.delete(routeKey)
    }
    if (sessions.size === 0) {
      this.sessionsByClient.delete(session.client)
      const subscription = this.subscriptions.get(session.client)
      subscription?.removeNotification()
      this.subscriptions.delete(session.client)
    }
  }

  private drain(client: LegacyPhysicalWorkerClient): void {
    const subscription = this.subscriptions.get(client)
    if (!subscription) {
      return
    }
    const retained: BufferedWorkerEvent[] = []
    let retainedBytes = 0
    for (const event of subscription.pending) {
      const session = this.sessionFor(client, event.params)
      if (session) {
        this.deliver(session, event.method, event.params)
      } else {
        retained.push(event)
        retainedBytes += event.bytes
      }
    }
    subscription.pending = retained
    subscription.pendingBytes = retainedBytes
  }

  dispose(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.removeNotification()
    }
    this.subscriptions.clear()
    this.sessionsByClient.clear()
  }

  private accept(
    client: LegacyPhysicalWorkerClient,
    method: string,
    params: Record<string, unknown>,
    subscription: WorkerSubscription
  ): void {
    if (method !== 'pty.data' && method !== 'pty.exit') {
      return
    }
    const session = this.sessionFor(client, params)
    if (session) {
      this.deliver(session, method, params)
      return
    }
    const bytes = Buffer.byteLength(JSON.stringify(params))
    if (
      subscription.pending.length >= MAX_PENDING_WORKER_EVENTS ||
      subscription.pendingBytes + bytes > MAX_PENDING_WORKER_EVENT_BYTES
    ) {
      client.close()
      this.reportWorkerFault(new Error('legacy physical worker pending event capacity exceeded'))
      return
    }
    subscription.pending.push({ method, params: structuredClone(params), bytes })
    subscription.pendingBytes += bytes
  }

  private deliver(
    session: ImportedPhysicalWorkerPtySession,
    method: string,
    params: Record<string, unknown>
  ): void {
    try {
      if (method === 'pty.data') {
        const span = parseLegacyPhysicalWorkerSourceSpan(params)
        assertSessionSpan(session, span)
        session.proxy.acceptData(span)
        return
      }
      const exit = parseLegacyPhysicalWorkerExit(params)
      if (
        exit.id !== session.binding.physicalPtyId ||
        exit.incarnationId !== session.binding.ptyIncarnationId
      ) {
        throw new Error('legacy physical worker exit identity changed')
      }
      session.upstreamExited = true
      this.acceptExit(session, exit)
    } catch (error) {
      session.client.close()
      this.reportWorkerFault(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private sessionFor(
    client: LegacyPhysicalWorkerClient,
    params: Record<string, unknown>
  ): ImportedPhysicalWorkerPtySession | undefined {
    const session = this.sessionsByClient.get(client)?.get(workerEventRouteKey(params))
    return session && !session.retired && session.route.isCurrent() ? session : undefined
  }
}

function workerEventRouteKey(params: Record<string, unknown>): string {
  const id = typeof params.id === 'string' ? params.id : ''
  const incarnationId =
    typeof params.incarnationId === 'string'
      ? params.incarnationId
      : typeof params.ptyIncarnation === 'string'
        ? params.ptyIncarnation
        : ''
  return JSON.stringify([id, incarnationId])
}

function assertSessionSpan(session: ImportedPhysicalWorkerPtySession, span: PtySourceSpan): void {
  const expected = session.upstreamIdentity
  if (
    span.id !== expected.id ||
    span.providerGeneration !== expected.providerGeneration ||
    span.clientGeneration !== expected.clientGeneration ||
    span.ownerGeneration !== expected.ownerGeneration ||
    span.ptyIncarnation !== expected.ptyIncarnation ||
    span.deliveryToken !== expected.deliveryToken
  ) {
    throw new Error('legacy physical worker source identity changed')
  }
}
