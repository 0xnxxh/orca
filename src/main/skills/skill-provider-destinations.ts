import { join } from 'node:path'

export type OrcaSkillProviderId = 'codex' | 'claude'

export type SkillProviderDestination = {
  provider: OrcaSkillProviderId
  readsCanonicalRoot: boolean
  rootPath: string
}

const SUPPORTED_PROVIDER_IDS = new Set<OrcaSkillProviderId>(['codex', 'claude'])

export function resolveSkillProviderDestinations(input: {
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
  detectedProviders: readonly string[]
}): SkillProviderDestination[] {
  const detected = new Set(
    input.detectedProviders.filter((provider): provider is OrcaSkillProviderId =>
      SUPPORTED_PROVIDER_IDS.has(provider as OrcaSkillProviderId)
    )
  )
  const scopeRoot = input.scope === 'global' ? input.homeDirectory : input.workspaceDirectory
  if (!scopeRoot) {
    throw new Error('skill-install-workspace-required')
  }
  const destinations: SkillProviderDestination[] = []
  if (detected.has('codex')) {
    destinations.push({
      provider: 'codex',
      readsCanonicalRoot: true,
      rootPath: join(scopeRoot, '.agents', 'skills')
    })
  }
  if (detected.has('claude')) {
    destinations.push({
      provider: 'claude',
      readsCanonicalRoot: false,
      rootPath: join(scopeRoot, '.claude', 'skills')
    })
  }
  return destinations
}
