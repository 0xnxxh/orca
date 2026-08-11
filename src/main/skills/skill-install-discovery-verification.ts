import { dirname, posix, resolve } from 'node:path'
import type { SkillInstallResult, SkillPlacementResult } from '../../shared/skill-install-contract'
import type { SkillDiscoveryResult } from '../../shared/skills'
import { discoverSkills } from './discovery'
import { discoverSkillsInWsl } from './skill-discovery-wsl'

function normalizedPath(path: string, wslDistro?: string): string {
  const normalized = wslDistro ? path.replace(/\/+$/, '') : resolve(path)
  return !wslDistro && process.platform === 'win32'
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

function placementIsDiscovered(
  discovery: SkillDiscoveryResult,
  placement: SkillPlacementResult,
  skillName: string,
  wslDistro?: string
): boolean {
  const placementPath = normalizedPath(placement.path, wslDistro)
  const placementRoot = normalizedPath(
    wslDistro ? posix.dirname(placement.path) : dirname(placement.path),
    wslDistro
  )
  return discovery.skills.some((skill) => {
    if (skill.name !== skillName) {
      return false
    }
    if (normalizedPath(skill.directoryPath, wslDistro) === placementPath) {
      return true
    }
    return (skill.rootPaths ?? [skill.rootPath]).some(
      (root) => normalizedPath(root, wslDistro) === placementRoot
    )
  })
}

async function discoverInstalledSkill(input: {
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
  wslDistro?: string
}): Promise<SkillDiscoveryResult> {
  if (input.wslDistro) {
    return discoverSkillsInWsl({
      distro: input.wslDistro,
      homeDir: input.homeDirectory,
      cwd: input.workspaceDirectory ?? input.homeDirectory
    })
  }
  return discoverSkills({
    homeDir: input.homeDirectory,
    repos: [],
    ...(input.scope === 'workspace' && input.workspaceDirectory
      ? { cwd: input.workspaceDirectory }
      : { includeCwd: false })
  })
}

export async function verifySkillInstallDiscovery(input: {
  result: SkillInstallResult
  scope: 'global' | 'workspace'
  homeDirectory: string
  workspaceDirectory?: string
  wslDistro?: string
  discover?: () => Promise<SkillDiscoveryResult>
}): Promise<SkillInstallResult> {
  const discovery = await (input.discover?.() ?? discoverInstalledSkill(input)).catch(() => null)
  if (!discovery) {
    return {
      ...input.result,
      status: 'failed',
      errorCategory: 'skill-discovery-verification-failed',
      failure: {
        category: 'provider-placement',
        code: 'skill-discovery-verification-failed',
        retryable: true
      }
    }
  }

  const placements = input.result.placements.map((placement) => {
    if (
      (placement.status !== 'installed' && placement.status !== 'unchanged') ||
      placementIsDiscovered(discovery, placement, input.result.name, input.wslDistro)
    ) {
      return placement
    }
    return {
      ...placement,
      status: 'failed' as const,
      errorCategory: 'skill-discovery-placement-missing',
      failure: {
        category: 'provider-placement' as const,
        code: 'skill-discovery-placement-missing',
        retryable: true
      }
    }
  })
  const canonical = placements.find((placement) => placement.topology === 'canonical-copy')
  if (!canonical || canonical.status === 'failed') {
    return {
      ...input.result,
      status: 'failed',
      placements,
      errorCategory: 'skill-discovery-canonical-missing',
      failure: {
        category: 'provider-placement',
        code: 'skill-discovery-canonical-missing',
        retryable: true
      }
    }
  }
  return {
    ...input.result,
    status: placements.some(
      (placement) => placement.status === 'failed' || placement.status === 'skipped'
    )
      ? 'partial'
      : input.result.status,
    placements
  }
}
