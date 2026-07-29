const SAFE_SOCKET_EVENT_FIELDS = new Set(['code', 'isTrusted', 'type', 'wasClean'])

// Why: event values and extension field names can contain endpoints or host errors.
export function describeSocketEvent(event: unknown): { fields: string[] } {
  let fields: string[] = []
  try {
    fields =
      event && typeof event === 'object'
        ? Object.keys(event as object)
            .filter((key) => SAFE_SOCKET_EVENT_FIELDS.has(key))
            .sort()
        : []
  } catch {
    fields = []
  }
  return { fields }
}

export function redactSocketEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint).host || 'unknown'
  } catch {
    return 'unknown'
  }
}
