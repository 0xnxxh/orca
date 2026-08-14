import type { SkillCloudVersion } from '../../../../shared/skill-cloud-contract'
import { fileCountLabel } from './skill-display-labels'
import { summarizeExecutableContent } from './skill-share-preview-summary'

export type SkillChecklistFile = { path: string; size: number; executable: boolean }

export type SkillChecklistItem = {
  id: string
  name: string
  description: string
  files: readonly SkillChecklistFile[]
}

/** One shape for both package kinds: a single skill is a one-item checklist. */
export function checklistItemsFromVersion(version: SkillCloudVersion): SkillChecklistItem[] {
  if ('skills' in version.manifest) {
    return version.manifest.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      files: skill.files
    }))
  }
  return [
    {
      id: version.manifest.name,
      // Why: the version carries the published name and description; the
      // manifest copy is the fallback for packages that predate them.
      name: version.name || version.manifest.name,
      description: version.description || version.manifest.description,
      files: version.manifest.files
    }
  ]
}

export function isScriptFile(file: SkillChecklistFile): boolean {
  return file.path.startsWith('scripts/')
}

/** Row summary: how much is here, and whether any of it can run. */
export function checklistItemSummary(files: readonly SkillChecklistFile[]): {
  label: string
  risky: boolean
} {
  const risk = summarizeExecutableContent(
    files.filter(isScriptFile).length,
    files.filter((file) => file.executable).length
  )
  return { label: `${fileCountLabel(files.length)} · ${risk.label}`, risky: risk.risky }
}
