import { isPtyIncarnationId, type PtyIncarnationId } from './pty-incarnation'

export const PTY_STREAM_BINDING_NONCE_MAX_LENGTH = 128

export type PtyStreamSource = Readonly<{
  incarnationId: PtyIncarnationId
  streamBindingNonce: string
}>

export function isPtyStreamBindingNonce(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PTY_STREAM_BINDING_NONCE_MAX_LENGTH
  )
}

export function isPtyStreamSource(value: unknown): value is PtyStreamSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    isPtyIncarnationId((value as { incarnationId?: unknown }).incarnationId) &&
    isPtyStreamBindingNonce((value as { streamBindingNonce?: unknown }).streamBindingNonce)
  )
}
