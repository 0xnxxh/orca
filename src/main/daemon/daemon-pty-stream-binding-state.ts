import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import {
  isPtyStreamBindingNonce,
  isPtyStreamSource,
  type PtyStreamSource
} from '../../shared/pty-stream-binding-protocol'

type BoundPtyStreamSource = PtyStreamSource & { sessionId: string }

type PendingStreamBinding = {
  marker?: BoundPtyStreamSource
  response?: BoundPtyStreamSource
}

export class DaemonPtyStreamBindingState {
  private readonly pendingByNonce = new Map<string, PendingStreamBinding>()
  private readonly currentBySessionId = new Map<string, BoundPtyStreamSource>()

  constructor(private readonly maxPendingBindings = 4_096) {}

  begin(streamBindingNonce: string): void {
    if (
      !isPtyStreamBindingNonce(streamBindingNonce) ||
      this.pendingByNonce.has(streamBindingNonce)
    ) {
      throw new Error('daemon_stream_binding_nonce_invalid')
    }
    if (this.pendingByNonce.size >= this.maxPendingBindings) {
      throw new Error('daemon_stream_binding_capacity_exceeded')
    }
    this.pendingByNonce.set(streamBindingNonce, {})
  }

  acceptMarker(sessionId: string, value: unknown): PtyStreamSource | null {
    if (!sessionId || !isPtyStreamSource(value)) {
      return null
    }
    const pending = this.pendingByNonce.get(value.streamBindingNonce)
    if (!pending) {
      return null
    }
    const marker = { sessionId, ...value }
    if (
      (pending.marker && !sameBoundSource(pending.marker, marker)) ||
      (pending.response && !sameBoundSource(pending.response, marker))
    ) {
      this.cancel(value.streamBindingNonce)
      return null
    }
    pending.marker = marker
    this.currentBySessionId.set(sessionId, marker)
    this.settleIfComplete(value.streamBindingNonce, pending)
    return value
  }

  acceptResponse(
    streamBindingNonce: string,
    sessionId: string,
    incarnationId: unknown,
    echoedStreamBindingNonce: unknown
  ): boolean {
    const pending = this.pendingByNonce.get(streamBindingNonce)
    if (
      !pending ||
      echoedStreamBindingNonce !== streamBindingNonce ||
      !isPtyIncarnationId(incarnationId) ||
      !sessionId
    ) {
      this.cancel(streamBindingNonce)
      return false
    }
    const response = { sessionId, incarnationId, streamBindingNonce }
    if (pending.marker && !sameBoundSource(pending.marker, response)) {
      this.cancel(streamBindingNonce)
      return false
    }
    pending.response = response
    this.settleIfComplete(streamBindingNonce, pending)
    return true
  }

  cancel(streamBindingNonce: string): void {
    const pending = this.pendingByNonce.get(streamBindingNonce)
    this.pendingByNonce.delete(streamBindingNonce)
    if (!pending?.marker) {
      return
    }
    const current = this.currentBySessionId.get(pending.marker.sessionId)
    if (current?.streamBindingNonce === streamBindingNonce) {
      this.currentBySessionId.delete(pending.marker.sessionId)
    }
  }

  sourceFor(sessionId: string): PtyStreamSource | undefined {
    const source = this.currentBySessionId.get(sessionId)
    return source
      ? {
          incarnationId: source.incarnationId,
          streamBindingNonce: source.streamBindingNonce
        }
      : undefined
  }

  admittedIncarnationId(sessionId: string): string | undefined {
    return this.currentBySessionId.get(sessionId)?.incarnationId
  }

  admitsEvent(sessionId: string): boolean {
    return this.currentBySessionId.has(sessionId)
  }

  admitsExit(sessionId: string, incarnationId: unknown): boolean {
    const source = this.currentBySessionId.get(sessionId)
    return Boolean(source && source.incarnationId === incarnationId)
  }

  forget(sessionId: string, incarnationId?: string): void {
    const source = this.currentBySessionId.get(sessionId)
    if (!source || (incarnationId && source.incarnationId !== incarnationId)) {
      return
    }
    this.currentBySessionId.delete(sessionId)
  }

  clear(): void {
    this.pendingByNonce.clear()
    this.currentBySessionId.clear()
  }

  private settleIfComplete(streamBindingNonce: string, pending: PendingStreamBinding): void {
    if (pending.marker && pending.response) {
      this.pendingByNonce.delete(streamBindingNonce)
    }
  }
}

function sameBoundSource(left: BoundPtyStreamSource, right: BoundPtyStreamSource): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.incarnationId === right.incarnationId &&
    left.streamBindingNonce === right.streamBindingNonce
  )
}
