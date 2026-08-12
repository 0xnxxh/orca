import { writeSkillStateFile } from './skill-install-provenance'
import type { SkillInstallJournalV1 } from './skill-install-recovery'

export type SkillInstallJournalBoundary = 'before' | 'after'

export type SkillInstallTransactionDependencies = {
  onJournalTransition?: (
    phase: SkillInstallJournalV1['phase'],
    boundary: SkillInstallJournalBoundary
  ) => Promise<void>
}

export async function persistSkillInstallJournalTransition(
  statePath: string,
  journal: SkillInstallJournalV1,
  dependencies: SkillInstallTransactionDependencies
): Promise<void> {
  await dependencies.onJournalTransition?.(journal.phase, 'before')
  await writeSkillStateFile(statePath, journal)
  await dependencies.onJournalTransition?.(journal.phase, 'after')
}
