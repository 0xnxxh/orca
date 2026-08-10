import { sha256 } from '@noble/hashes/sha256'

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`
}

export function mobileStructuredCreateFingerprint(input: {
  sessionId: string
  worktree: string
}): string {
  const bytes = new TextEncoder().encode(
    canonicalize({
      method: 'agentSession.create',
      sessionId: input.sessionId,
      fields: { worktree: input.worktree, agent: 'codex' }
    })
  )
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function showMobileStructuredChatChoice(input: {
  hostCapability: boolean
  workspaceSupport: boolean
  agent: string
}): boolean {
  return input.hostCapability && input.workspaceSupport && input.agent === 'codex'
}
