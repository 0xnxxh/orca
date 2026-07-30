import type { TaskProvider } from '../../../../shared/types'
import type { IntegrationStatusTone } from '@/components/integration-status-pill'

export type TaskProviderReadiness = {
  connected: boolean
  checking: boolean
  /** Linear only — agent skill install. Other providers leave this undefined. */
  skillInstalled?: boolean
  skillChecking?: boolean
  visible: boolean
}

export type TaskProviderSetupStatus =
  | 'checking'
  | 'ready'
  | 'connect-required'
  | 'skill-required'
  | 'hidden'
  | 'incomplete'

export const TASK_PROVIDER_SETUP_STATUS_TONE: Record<
  TaskProviderSetupStatus,
  IntegrationStatusTone
> = {
  checking: 'neutral',
  ready: 'connected',
  // Why: hiding a provider is a deliberate choice, not something to warn about.
  hidden: 'neutral',
  'connect-required': 'attention',
  'skill-required': 'attention',
  incomplete: 'attention'
}

export function isTaskProviderChecking(readiness: TaskProviderReadiness): boolean {
  return readiness.checking || readiness.skillChecking === true
}

export function getTaskProviderCompletedSteps(readiness: TaskProviderReadiness): {
  completed: number
  total: number
} {
  const skillRequired = readiness.skillInstalled !== undefined
  const total = skillRequired ? 3 : 2
  let completed = 0
  if (readiness.connected) {
    completed += 1
  }
  if (skillRequired && readiness.skillInstalled) {
    completed += 1
  }
  if (readiness.visible) {
    completed += 1
  }
  return { completed, total }
}

export function isTaskProviderReady(readiness: TaskProviderReadiness): boolean {
  if (isTaskProviderChecking(readiness)) {
    return false
  }
  const { completed, total } = getTaskProviderCompletedSteps(readiness)
  return completed === total
}

export function getTaskProviderSetupStatus(
  readiness: TaskProviderReadiness
): TaskProviderSetupStatus {
  if (!readiness.visible) {
    return 'hidden'
  }
  if (isTaskProviderChecking(readiness)) {
    return 'checking'
  }
  if (isTaskProviderReady(readiness)) {
    return 'ready'
  }
  if (!readiness.connected) {
    return 'connect-required'
  }
  if (readiness.skillInstalled === false) {
    return 'skill-required'
  }
  // Fallback if a future readiness field can leave connected+skill true but not ready.
  return 'incomplete'
}

// Exclude in-flight checks so a cold settings open does not flash a warning.
export function getIncompleteVisibleTaskProviders(
  providers: readonly TaskProvider[],
  readinessByProvider: Record<TaskProvider, TaskProviderReadiness>
): TaskProvider[] {
  return providers.filter((provider) => {
    const readiness = readinessByProvider[provider]
    if (!readiness.visible || isTaskProviderChecking(readiness)) {
      return false
    }
    return !isTaskProviderReady(readiness)
  })
}

// Expand one unfinished provider because defaults expose every provider.
export function getAutoExpandedTaskProvider(
  providers: readonly TaskProvider[],
  readinessByProvider: Record<TaskProvider, TaskProviderReadiness>
): TaskProvider | null {
  return getIncompleteVisibleTaskProviders(providers, readinessByProvider)[0] ?? null
}
