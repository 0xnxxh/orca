export type ActiveVisibilityMutation = { kind: 'row'; path: string } | { kind: 'toggle' }

// Why: the modal unmounts on close, but its persistence request survives dismissal.
const activeMutations = new Map<string, ActiveVisibilityMutation>()
const mutationListeners = new Map<string, Set<() => void>>()

export function getActiveVisibilityMutation(repoId: string): ActiveVisibilityMutation | undefined {
  return activeMutations.get(repoId)
}

export function startVisibilityMutation(repoId: string, mutation: ActiveVisibilityMutation): void {
  activeMutations.set(repoId, mutation)
}

export function subscribeToVisibilityMutation(repoId: string, listener: () => void): () => void {
  const listeners = mutationListeners.get(repoId) ?? new Set()
  listeners.add(listener)
  mutationListeners.set(repoId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      mutationListeners.delete(repoId)
    }
  }
}

export function finishVisibilityMutation(repoId: string, mutation: ActiveVisibilityMutation): void {
  if (activeMutations.get(repoId) !== mutation) {
    return
  }
  activeMutations.delete(repoId)
  mutationListeners.get(repoId)?.forEach((listener) => listener())
}
