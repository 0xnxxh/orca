// Why: even a hostname identifies the paired desktop in shared logs.
export function redactedWebSocketEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    if (!url.host) {
      return 'unknown'
    }
    if (url.protocol === 'wss:') {
      return 'encrypted-websocket'
    }
    return url.protocol === 'ws:' ? 'websocket' : 'unknown'
  } catch {
    return 'unknown'
  }
}
