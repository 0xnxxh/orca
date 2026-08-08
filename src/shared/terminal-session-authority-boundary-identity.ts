import { createHash } from 'node:crypto'
import type { TerminalAuthorityNamespaceOutcomeBoundary } from './terminal-session-authority-consumer-transport'

export function terminalSessionAuthorityBoundaryId(
  boundary: Omit<TerminalAuthorityNamespaceOutcomeBoundary, 'boundaryId'>
): string {
  if (boundary.version !== 1) {
    throw new Error('terminal authority boundary version is invalid')
  }
  const payload = {
    version: boundary.version,
    consumer: boundary.consumer,
    namespace: boundary.namespace,
    acknowledgedSequence: boundary.acknowledgedSequence,
    outcomeHighWatermark: boundary.outcomeHighWatermark,
    consumerStart: boundary.consumerStart ?? null,
    projection: boundary.projection ?? null
  }
  const digest = createHash('sha256')
    .update(`terminal-session-authority-boundary:v1\0${canonicalJson(payload)}`)
    .digest('hex')
  return `authority-boundary:${digest}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('terminal authority boundary contains a non-finite number')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? 'null' : canonicalJson(entry))).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  throw new Error('terminal authority boundary contains an unsupported value')
}
