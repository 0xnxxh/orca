import { parse } from 'yaml'

export const MAX_BEHAVIOR_INERT_AGENT_METADATA_BYTES = 16 * 1024

const OPENAI_PRESENTATION_FIELDS = new Set([
  'display_name',
  'short_description',
  'icon_small',
  'icon_large',
  'brand_color'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isBehaviorInertAgentMetadata(
  path: string,
  bytes: Buffer,
  executable: boolean
): boolean {
  if (
    path !== 'agents/openai.yaml' ||
    executable ||
    bytes.length > MAX_BEHAVIOR_INERT_AGENT_METADATA_BYTES
  ) {
    return false
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const metadata: unknown = parse(text, { maxAliasCount: 0 })
    if (!isRecord(metadata) || Object.keys(metadata).some((key) => key !== 'interface')) {
      return false
    }
    const agentInterface = metadata.interface
    return (
      isRecord(agentInterface) &&
      Object.entries(agentInterface).every(
        ([key, value]) => OPENAI_PRESENTATION_FIELDS.has(key) && typeof value === 'string'
      )
    )
  } catch {
    return false
  }
}
