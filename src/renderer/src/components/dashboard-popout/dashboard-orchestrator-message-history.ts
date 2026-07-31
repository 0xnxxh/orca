export type DashboardOrchestratorMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  byteLength: number
}

export const MAX_DASHBOARD_ORCHESTRATOR_MESSAGES = 200
export const MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES = 1024 * 1024

const encoder = new TextEncoder()
const TRUNCATION_MARKER = '…'
const TRUNCATION_MARKER_BYTES = encoder.encode(TRUNCATION_MARKER).byteLength

function boundMessageText(text: string): { text: string; byteLength: number } {
  const encoded = encoder.encode(text)
  if (encoded.byteLength <= MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES) {
    return { text, byteLength: encoded.byteLength }
  }
  const prefix = new TextDecoder().decode(
    encoded.subarray(0, MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES - TRUNCATION_MARKER_BYTES),
    { stream: true }
  )
  return {
    text: `${prefix}${TRUNCATION_MARKER}`,
    byteLength: encoder.encode(prefix).byteLength + TRUNCATION_MARKER_BYTES
  }
}

export function appendDashboardOrchestratorMessage(
  current: DashboardOrchestratorMessage[],
  message: Omit<DashboardOrchestratorMessage, 'byteLength'>
): DashboardOrchestratorMessage[] {
  const bounded = boundMessageText(message.text)
  const next = [...current, { ...message, ...bounded }]
  let retainedBytes = next.reduce((total, entry) => total + entry.byteLength, 0)
  let removeCount = 0
  while (
    next.length - removeCount > MAX_DASHBOARD_ORCHESTRATOR_MESSAGES ||
    retainedBytes > MAX_DASHBOARD_ORCHESTRATOR_MESSAGE_BYTES
  ) {
    retainedBytes -= next[removeCount]!.byteLength
    removeCount += 1
  }
  return removeCount === 0 ? next : next.slice(removeCount)
}
