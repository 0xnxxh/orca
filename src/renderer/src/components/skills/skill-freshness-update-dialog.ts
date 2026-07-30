import type { SkillUpdateRun } from '../../../../shared/skill-freshness'
import type { SkillFreshnessState } from '@/hooks/skill-freshness'
import type { SkillUpdateRowStateIcons } from './SkillUpdateRow'

let pendingOpen = false
const listeners = new Set<() => void>()

export type SkillFreshnessUpdateDialogRequestSnapshot = () => boolean
export type SkillFreshnessUpdateDialogRequestSubscriber = (listener: () => void) => () => void
export type SkillFreshnessUpdateDialogDependencies = {
  acknowledgeUpdateRun: () => Promise<void>
  cancelUpdateRun: () => Promise<void>
  consumeOpenRequest: () => boolean
  getOpenRequest: SkillFreshnessUpdateDialogRequestSnapshot
  notifyInstalledSkillsChanged: () => void
  rowStateIcons: SkillUpdateRowStateIcons
  startUpdateRun: (names: readonly string[]) => Promise<void>
  subscribeOpenRequest: SkillFreshnessUpdateDialogRequestSubscriber
  useFreshness: () => SkillFreshnessState
  useUpdateRun: () => SkillUpdateRun
}

// Why: the nudge action can fire before the dialog subscribes. Keeping the
// request as an external snapshot prevents mount ordering from losing it.
export function requestSkillFreshnessUpdateDialog(): void {
  pendingOpen = true
  for (const listener of listeners) {
    listener()
  }
}

export function consumeSkillFreshnessUpdateDialogRequest(): boolean {
  const requested = pendingOpen
  pendingOpen = false
  if (requested) {
    for (const listener of listeners) {
      listener()
    }
  }
  return requested
}

export function getSkillFreshnessUpdateDialogRequest(): boolean {
  return pendingOpen
}

export function subscribeSkillFreshnessUpdateDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
