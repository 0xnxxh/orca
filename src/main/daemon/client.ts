import type { Socket } from 'node:net'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PROTOCOL_VERSION, NOTIFY_PREFIX, DaemonProtocolError } from './types'
import type { DaemonEndpointIdentity } from './types'
import { sameDaemonIdentity } from './daemon-endpoint-identity'
import { connectDaemonSocket, waitForConnectionAttempt } from './daemon-client-socket-connect'
import { sendDaemonHello } from './daemon-client-hello-handshake'
import {
  rejectAllPendingRequests,
  sendDaemonRequest,
  writeDaemonNotify,
  type PendingRequest
} from './daemon-client-pending-requests'
import {
  attachControlResponseReader,
  attachStreamEventReader
} from './daemon-client-ndjson-readers'

const CONNECT_TIMEOUT_MS = 5000
const CONNECTION_ATTEMPT_WAIT_MS = CONNECT_TIMEOUT_MS * 4
const REQUEST_TIMEOUT_MS = 30000

export type DaemonClientOptions = {
  socketPath: string
  tokenPath: string
  protocolVersion?: number
}

export class DaemonClient {
  private socketPath: string
  private tokenPath: string
  private protocolVersion: number
  private clientId = randomUUID()

  private controlSocket: Socket | null = null
  private streamSocket: Socket | null = null
  private connected = false
  private disconnectArmed = false
  // Why: after a disconnect + reconnect (daemon respawn), a stale 'close'
  // event from the old sockets can fire. Without a generation check, that
  // event would tear down the fresh connection. Each doConnect() increments
  // the generation; handleDisconnect ignores events from old generations.
  private connectionGeneration = 0
  // Why: multiple concurrent spawn() calls from simultaneous pane mounts
  // all call ensureConnected(). Without a lock, each starts a separate
  // connection attempt, overwriting sockets and triggering "Connection lost".
  private connectingPromise: Promise<void> | null = null
  private connectionAttemptGeneration = 0
  private daemonIdentity: DaemonEndpointIdentity | null = null
  private observedAuthenticatedDisconnect = false

  private pendingRequests = new Map<string, PendingRequest>()
  private eventListeners: ((event: unknown) => void)[] = []
  private disconnectedListeners: (() => void)[] = []
  private requestCounter = 0
  private cleanupSocketListeners: (() => void) | null = null

  constructor(opts: DaemonClientOptions) {
    this.socketPath = opts.socketPath
    this.tokenPath = opts.tokenPath
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION
  }

  isConnected(): boolean {
    return this.connected
  }

  getDaemonIdentity(): DaemonEndpointIdentity | null {
    return this.daemonIdentity ? { ...this.daemonIdentity } : null
  }

  hasObservedAuthenticatedDisconnect(): boolean {
    return this.observedAuthenticatedDisconnect
  }

  async ensureConnected(): Promise<void> {
    return this.ensureConnectedWithTimeout(CONNECT_TIMEOUT_MS, false)
  }

  async ensureConnectedWithin(timeoutMs: number): Promise<void> {
    return this.ensureConnectedWithTimeout(timeoutMs, true)
  }

  private async ensureConnectedWithTimeout(
    timeoutMs: number,
    sharedBudget: boolean
  ): Promise<void> {
    if (this.connected) {
      return
    }
    if (this.connectingPromise) {
      // Why: a normal connection may legitimately consume one timeout for each
      // socket and hello; bounded teardown calls instead keep their one shared budget.
      const waiterTimeoutMs = sharedBudget ? timeoutMs : CONNECTION_ATTEMPT_WAIT_MS
      return waitForConnectionAttempt(this.connectingPromise, waiterTimeoutMs)
    }

    const attemptGeneration = this.connectionAttemptGeneration
    this.connectingPromise = this.doConnect(timeoutMs, attemptGeneration, sharedBudget)
    try {
      await this.connectingPromise
    } finally {
      this.connectingPromise = null
    }
  }

  // Why: a missing token must not preempt the connect that proves whether the endpoint is gone.
  private readToken(): string {
    try {
      return readFileSync(this.tokenPath, 'utf-8').trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        return ''
      }
      throw error
    }
  }

  private async doConnect(
    timeoutMs: number,
    attemptGeneration: number,
    sharedBudget: boolean
  ): Promise<void> {
    const token = this.readToken()
    const deadlineMs = Date.now() + timeoutMs
    const remainingMs = (): number =>
      sharedBudget ? Math.max(1, deadlineMs - Date.now()) : timeoutMs
    const pendingListenerCleanups: (() => void)[] = []
    const cleanupPendingListeners = (): void => {
      for (const cleanup of pendingListenerCleanups.splice(0)) {
        cleanup()
      }
    }

    try {
      // Sequential: control first, then stream
      const pendingControlSocket = await connectDaemonSocket(this.socketPath, remainingMs())
      this.assertConnectionAttemptCurrent(attemptGeneration, pendingControlSocket)
      this.controlSocket = pendingControlSocket
      const controlIdentity = await sendDaemonHello({
        socket: this.controlSocket,
        token,
        role: 'control',
        clientId: this.clientId,
        protocolVersion: this.protocolVersion,
        timeoutMs: remainingMs()
      })
      this.assertConnectionAttemptCurrent(attemptGeneration, this.controlSocket)
      pendingListenerCleanups.push(
        attachControlResponseReader(this.controlSocket, this.pendingRequests)
      )

      const pendingStreamSocket = await connectDaemonSocket(this.socketPath, remainingMs())
      this.assertConnectionAttemptCurrent(attemptGeneration, pendingStreamSocket)
      this.streamSocket = pendingStreamSocket
      const streamIdentity = await sendDaemonHello({
        socket: this.streamSocket,
        token,
        role: 'stream',
        clientId: this.clientId,
        protocolVersion: this.protocolVersion,
        timeoutMs: remainingMs()
      })
      this.assertConnectionAttemptCurrent(attemptGeneration, this.streamSocket)
      if (!sameDaemonIdentity(controlIdentity, streamIdentity)) {
        throw new DaemonProtocolError('Daemon identity changed during connection')
      }
      pendingListenerCleanups.push(attachStreamEventReader(this.streamSocket, this.eventListeners))

      this.assertConnectionAttemptCurrent(attemptGeneration)
      this.connected = true
      this.observedAuthenticatedDisconnect = false
      this.daemonIdentity = controlIdentity
      this.disconnectArmed = true
      this.connectionGeneration++

      const gen = this.connectionGeneration
      const handleClose = () => this.handleDisconnect(gen)
      const controlSocket = this.controlSocket
      const streamSocket = this.streamSocket
      controlSocket.on('close', handleClose)
      controlSocket.on('error', handleClose)
      streamSocket.on('close', handleClose)
      streamSocket.on('error', handleClose)
      pendingListenerCleanups.push(() => {
        controlSocket.off('close', handleClose)
        controlSocket.off('error', handleClose)
        streamSocket.off('close', handleClose)
        streamSocket.off('error', handleClose)
      })
      this.cleanupSocketListeners = cleanupPendingListeners
    } catch (error) {
      cleanupPendingListeners()
      this.controlSocket?.destroy()
      this.streamSocket?.destroy()
      this.controlSocket = null
      this.streamSocket = null
      this.connected = false
      this.daemonIdentity = null
      this.disconnectArmed = false
      throw error
    }
  }

  async request<T = unknown>(
    type: string,
    payload: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (!this.connected || !this.controlSocket) {
      throw new DaemonProtocolError('Not connected')
    }

    const id = `req-${++this.requestCounter}`
    return sendDaemonRequest<T>(
      this.controlSocket,
      this.pendingRequests,
      id,
      type,
      payload,
      timeoutMs
    )
  }

  // Why: fire-and-forget writes need a local delivery signal to trigger dead-endpoint recovery.
  notify(type: string, payload: unknown): boolean {
    if (!this.connected || !this.controlSocket) {
      return false
    }

    const id = `${NOTIFY_PREFIX}${++this.requestCounter}`
    return writeDaemonNotify(this.controlSocket, id, type, payload)
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.eventListeners.push(listener)
    return () => {
      const idx = this.eventListeners.indexOf(listener)
      if (idx !== -1) {
        this.eventListeners.splice(idx, 1)
      }
    }
  }

  onDisconnected(listener: () => void): () => void {
    this.disconnectedListeners.push(listener)
    return () => {
      const idx = this.disconnectedListeners.indexOf(listener)
      if (idx !== -1) {
        this.disconnectedListeners.splice(idx, 1)
      }
    }
  }

  disconnect(): void {
    this.connectionAttemptGeneration++
    this.connected = false
    this.daemonIdentity = null
    this.disconnectArmed = false
    this.cleanupActiveSocketListeners()

    rejectAllPendingRequests(this.pendingRequests, 'Disconnected')

    this.controlSocket?.destroy()
    this.streamSocket?.destroy()
    this.controlSocket = null
    this.streamSocket = null
  }

  private assertConnectionAttemptCurrent(attemptGeneration: number, socket?: Socket): void {
    if (attemptGeneration === this.connectionAttemptGeneration) {
      return
    }
    socket?.destroy()
    throw new DaemonProtocolError('Disconnected')
  }

  private handleDisconnect(generation: number): void {
    if (!this.disconnectArmed || generation !== this.connectionGeneration) {
      return
    }
    this.disconnectArmed = false
    this.connectionAttemptGeneration++
    if (this.daemonIdentity) {
      this.observedAuthenticatedDisconnect = true
    }
    this.connected = false
    this.daemonIdentity = null
    this.cleanupActiveSocketListeners()

    rejectAllPendingRequests(this.pendingRequests, 'Connection lost')

    this.controlSocket?.destroy()
    this.streamSocket?.destroy()
    this.controlSocket = null
    this.streamSocket = null

    for (const listener of this.disconnectedListeners) {
      listener()
    }
  }

  private cleanupActiveSocketListeners(): void {
    const cleanup = this.cleanupSocketListeners
    this.cleanupSocketListeners = null
    cleanup?.()
  }
}
