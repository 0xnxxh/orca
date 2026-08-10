import { sha256 } from '@noble/hashes/sha256'
import type { MobileStructuredOutboxEntry } from './mobile-structured-outbox-store'

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`
}

export function mobileStructuredPayloadFingerprint(input: {
  method: string
  sessionId: string
  fields: Record<string, unknown>
}): string {
  const bytes = sha256(
    new TextEncoder().encode(
      canonicalize({ method: input.method, sessionId: input.sessionId, fields: input.fields })
    )
  )
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createMobileStructuredOperationId(
  prefix: string,
  randomUuid: () => string,
  now: number = Date.now()
): string {
  return `${prefix}:${now.toString(36)}:${randomUuid()}`
}

export function mobileStructuredSendRequest(
  entry: MobileStructuredOutboxEntry,
  expectedRuntimeFence: number
): Record<string, unknown> {
  const fields = { body: entry.body }
  return {
    envelope: {
      sessionId: entry.sessionId,
      clientOperationId: entry.clientMessageId,
      expectedRuntimeFence,
      payloadFingerprint: mobileStructuredPayloadFingerprint({
        method: 'agentSession.send',
        sessionId: entry.sessionId,
        fields
      })
    },
    ...fields
  }
}
