export const MERMAID_DIAGRAM_MESSAGE_CHANNEL = 'orca-mobile-mermaid'
export const MERMAID_DIAGRAM_ENGINE_MESSAGE_CHANNEL = 'orca-mobile-mermaid-engine'
export const MERMAID_DIAGRAM_MAX_SOURCE_CHARACTERS = 128 * 1024

export function parseMermaidDiagramMessage(
  value: unknown,
  expectedToken = ''
): { type: 'ready' } | { type: 'rendered'; height: number } | { type: 'error' } | null {
  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const message = parsed as Record<string, unknown>
    if (message.channel !== MERMAID_DIAGRAM_MESSAGE_CHANNEL || message.token !== expectedToken) {
      return null
    }
    if (message.type === 'error') {
      return { type: 'error' }
    }
    if (message.type === 'ready') {
      return { type: 'ready' }
    }
    if (
      message.type === 'rendered' &&
      typeof message.height === 'number' &&
      Number.isFinite(message.height) &&
      message.height > 0 &&
      message.height <= 10000
    ) {
      return { type: 'rendered', height: Math.ceil(message.height) }
    }
    return null
  } catch {
    return null
  }
}
