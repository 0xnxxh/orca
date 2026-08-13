export type ProviderFrameDisposition = 'debug-only' | 'timeline'

const ERROR_VARIANT_KEYS = new Set(['type', 'status', 'state', 'subtype', 'outcome'])
const ERROR_VALUE_KEYS = new Set(['error', 'failureReason', 'failure_reason'])

function isErrorVariant(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.replace(/[_\s-]/g, '').toLowerCase()
  return (
    normalized.startsWith('error') || normalized.startsWith('fail') || normalized === 'systemerror'
  )
}

function hasProviderError(payload: unknown): boolean {
  const pending = [payload]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) {
      continue
    }
    seen.add(value)
    if (Array.isArray(value)) {
      pending.push(...value)
      continue
    }
    for (const [key, nested] of Object.entries(value)) {
      if ((key === 'isError' || key === 'is_error') && nested === true) {
        return true
      }
      if (key === 'success' && nested === false) {
        return true
      }
      if (ERROR_VARIANT_KEYS.has(key) && isErrorVariant(nested)) {
        return true
      }
      if (ERROR_VALUE_KEYS.has(key) && nested !== null && nested !== false && nested !== '') {
        return true
      }
      pending.push(nested)
    }
  }
  return false
}

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

export function classifyProviderFrame(
  provider: string,
  kind: string,
  payload: unknown
): ProviderFrameDisposition {
  if (hasProviderError(payload)) {
    return 'timeline'
  }
  if (provider === 'codex' && isCodexStatusFrame(kind)) {
    return 'debug-only'
  }
  if (provider === 'claude' && isClaudeStatusFrame(kind)) {
    if (kind === 'message:result') {
      const record =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : null
      return record?.subtype === 'success' ? 'debug-only' : 'timeline'
    }
    return 'debug-only'
  }
  return 'timeline'
}
