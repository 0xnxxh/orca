import { useRef, useState } from 'react'
import type {
  MobileSessionTabCreateKind,
  MobileSessionTabIntentTracker
} from './mobile-session-tab-intent-tracker'

type CreatingRef = { current: boolean }
type StateSetter<T> = (value: T) => void
export type CreateState = readonly [CreatingRef, StateSetter<boolean>, StateSetter<string>]
type ErrorFeedback = readonly [
  StateSetter<string>,
  () => void,
  (message: string, durationMs?: number) => void
]
type CaughtErrorFeedback = readonly [
  StateSetter<string>,
  (message: string, durationMs?: number) => void
]

export function useCreateState(
  setCreateError: StateSetter<string>
): readonly [boolean, CreateState] {
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)
  return [creating, [creatingRef, setCreating, setCreateError]]
}

export function isCreating(state: CreateState): boolean {
  return state[0].current
}

export function bindRoute(
  tracker: MobileSessionTabIntentTracker,
  hostId: string,
  worktreeId: string
): (kind: MobileSessionTabCreateKind, state: CreateState) => () => boolean {
  return (kind, state) => {
    const revision = tracker.beginTabCreate(kind)
    state[0].current = true
    state[1](true)
    state[2]('')
    return () => tracker.isTabCreateCurrent(hostId, worktreeId, kind, revision)
  }
}

export function resetRoute(
  tracker: MobileSessionTabIntentTracker,
  states: readonly CreateState[]
): void {
  tracker.supersede()
  tracker.invalidateTabCreates()
  for (const [creatingRef, setCreating, setCreateError] of states) {
    creatingRef.current = false
    setCreating(false)
    setCreateError('')
  }
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

export function reportCaughtError(
  error: unknown,
  kind: Exclude<MobileSessionTabCreateKind, 'terminal'>,
  isCurrent: () => boolean,
  feedback: CaughtErrorFeedback
): void {
  if (!isCurrent()) {
    return
  }
  const fallback =
    kind === 'browser' ? 'Failed to create browser' : 'Failed to create markdown note'
  const message = error instanceof Error ? error.message : fallback
  feedback[0](message)
  feedback[1](message, 1800)
}
