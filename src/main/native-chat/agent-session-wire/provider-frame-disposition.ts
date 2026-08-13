export type ProviderFrameDisposition = 'debug-only' | 'timeline'

function notificationKind(kind: string): string {
  return kind.startsWith('notification:') ? kind.slice('notification:'.length) : kind
}

function isCodexStatusFrame(kind: string): boolean {
  const method = notificationKind(kind)
  return (
    /^(?:thread\/(?:started|closed|archived|unarchived)|thread\/(?:name|status)\/(?:changed|updated))$/.test(
      method
    ) ||
    /^thread\/(?:tokenUsage\/updated|goal\/(?:updated|cleared))$/.test(method) ||
    method === 'mcpServer/startupStatus/updated' ||
    method === 'remoteControl/status/changed'
  )
}

function isClaudeStatusFrame(kind: string): boolean {
  return (
    kind === 'message:system:init' ||
    kind === 'message:system:status' ||
    kind === 'message:result' ||
    /^message:stream_event:(?:message_start|message_stop|content_block_start|content_block_stop)$/.test(
      kind
    )
  )
}

export function classifyProviderFrame(provider: string, kind: string): ProviderFrameDisposition {
  if (provider === 'codex' && isCodexStatusFrame(kind)) {
    return 'debug-only'
  }
  if (provider === 'claude' && isClaudeStatusFrame(kind)) {
    return 'debug-only'
  }
  return 'timeline'
}
