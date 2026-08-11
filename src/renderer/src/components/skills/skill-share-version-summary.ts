import type { SkillCloudVersion } from '../../../../shared/skill-cloud-contract'

export type ResolvedSkillShare = { shareId: string; version: SkillCloudVersion }

export function summarizeSkillShareVersion(version: SkillCloudVersion | undefined): {
  scriptCount: number
  executableCount: number
} {
  return {
    scriptCount:
      version?.manifest.files.filter((file) => file.path.startsWith('scripts/')).length ?? 0,
    executableCount: version?.manifest.files.filter((file) => file.executable).length ?? 0
  }
}
