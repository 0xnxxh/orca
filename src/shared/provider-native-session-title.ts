import type { AiVaultAgent } from './ai-vault-types'

export type ProviderNativeSessionTitle = {
  agent: Extract<AiVaultAgent, 'claude' | 'codex'>
  sessionId: string
  title: string
}

export function isProviderNativeTitleAgent(
  agent: string | null | undefined
): agent is ProviderNativeSessionTitle['agent'] {
  return agent === 'claude' || agent === 'codex'
}
