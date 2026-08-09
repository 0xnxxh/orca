import type { MobileSessionTabIntentTracker } from './mobile-session-tab-intent-tracker'

type CreatingRef = { current: boolean }
type StateSetter<T> = (value: T) => void
type CreateState = readonly [CreatingRef, StateSetter<boolean>, StateSetter<string>]
type ErrorFeedback = readonly [
  StateSetter<string>,
  () => void,
  (message: string, durationMs?: number) => void
]

export function resetRoute(tracker: MobileSessionTabIntentTracker, state: CreateState): void {
  const [creatingRef, setCreating, setCreateError] = state
  tracker.supersede()
  tracker.invalidateTerminalCreate()
  creatingRef.current = false
  setCreating(false)
  setCreateError('')
}

export function finish(isCurrent: () => boolean, state: CreateState): void {
  if (!isCurrent()) {
    return
  }
  state[0].current = false
  state[1](false)
}

export function reportError(
  errorToast: string | undefined,
  isCurrent: () => boolean,
  feedback: ErrorFeedback
): void {
  if (!isCurrent()) {
    return
  }
  const [setCreateError, onError, showToast] = feedback
  const message = errorToast ?? 'Failed to create terminal'
  setCreateError(message)
  if (errorToast) {
    onError()
    showToast(message, 1800)
  }
}
