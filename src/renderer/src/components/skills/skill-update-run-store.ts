import { useSyncExternalStore } from 'react'
import type { SkillUpdateRun } from '../../../../shared/skill-freshness'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/useInstalledAgentSkills'

// Why: the run outlives the dialog — closing the window must not cancel it, and
// the status-bar segment needs the same snapshot. Keeping it outside React means
// neither surface owns the lifecycle.
let run: SkillUpdateRun = { state: 'idle' }
const listeners = new Set<() => void>()
let subscribed = false
let successTimer: ReturnType<typeof setTimeout> | null = null

/** How long a finished run keeps its green check in the status bar. */
export const SKILL_UPDATE_SUCCESS_LINGER_MS = 4000

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function setRun(next: SkillUpdateRun): void {
  run = next
  if (successTimer) {
    clearTimeout(successTimer)
    successTimer = null
  }
  if (next.state === 'success') {
    // Why: a success needs to be *seen*, then get out of the way. Errors stay
    // until the user acts on them.
    successTimer = setTimeout(() => {
      successTimer = null
      void window.api.skills.acknowledgeUpdateRun()
    }, SKILL_UPDATE_SUCCESS_LINGER_MS)
  }
  if (next.state === 'success' || next.state === 'error') {
    // A finished run changes what's on disk; let every skills surface re-read.
    notifyInstalledAgentSkillsChanged()
  }
  emit()
}

function ensureSubscribed(): void {
  if (subscribed) {
    return
  }
  subscribed = true
  window.api.skills.onUpdateRun(setRun)
  void window.api.skills.getUpdateRun().then((current) => {
    // Don't clobber a live push that landed while this promise was in flight.
    if (run.state === 'idle') {
      setRun(current)
    }
  })
}

export function subscribeSkillUpdateRun(listener: () => void): () => void {
  ensureSubscribed()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSkillUpdateRun(): SkillUpdateRun {
  return run
}

export function useSkillUpdateRun(): SkillUpdateRun {
  return useSyncExternalStore(subscribeSkillUpdateRun, getSkillUpdateRun, getSkillUpdateRun)
}

export async function startSkillUpdateRun(names: readonly string[]): Promise<void> {
  ensureSubscribed()
  await window.api.skills.startUpdateRun([...names])
}

export async function cancelSkillUpdateRun(): Promise<void> {
  await window.api.skills.cancelUpdateRun()
}

export async function acknowledgeSkillUpdateRun(): Promise<void> {
  await window.api.skills.acknowledgeUpdateRun()
}

/** @internal - tests need a clean module between cases. */
export function _resetSkillUpdateRunStore(): void {
  run = { state: 'idle' }
  subscribed = false
  if (successTimer) {
    clearTimeout(successTimer)
    successTimer = null
  }
  listeners.clear()
}
