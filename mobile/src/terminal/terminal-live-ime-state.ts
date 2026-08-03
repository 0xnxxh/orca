export type TerminalLiveImeBoundary = {
  readonly generation: number
  readonly handle: string
}

type TerminalLiveImeWaiter = {
  readonly boundary: TerminalLiveImeBoundary
  readonly promise: Promise<boolean>
  readonly resolve: (committed: boolean) => void
}

export type TerminalLiveImeState = {
  owner: TerminalLiveImeBoundary | null
  waiter: TerminalLiveImeWaiter | null
}

export function createTerminalLiveImeState(): TerminalLiveImeState {
  return { owner: null, waiter: null }
}

export function isSameTerminalLiveImeBoundary(
  left: TerminalLiveImeBoundary,
  right: TerminalLiveImeBoundary
): boolean {
  return left.generation === right.generation && left.handle === right.handle
}

export function beginTerminalLiveImeComposition(
  state: TerminalLiveImeState,
  boundary: TerminalLiveImeBoundary
): void {
  if (state.owner && isSameTerminalLiveImeBoundary(state.owner, boundary)) {
    return
  }
  invalidateTerminalLiveImeComposition(state)
  state.owner = boundary
}

export function waitForTerminalLiveImeComposition(
  state: TerminalLiveImeState,
  boundary: TerminalLiveImeBoundary
): Promise<boolean> | null {
  if (!state.owner || !isSameTerminalLiveImeBoundary(state.owner, boundary)) {
    return null
  }
  if (state.waiter && isSameTerminalLiveImeBoundary(state.waiter.boundary, boundary)) {
    return state.waiter.promise
  }
  let resolveWaiter: (committed: boolean) => void = () => undefined
  const promise = new Promise<boolean>((resolve) => {
    resolveWaiter = resolve
  })
  state.waiter = { boundary, promise, resolve: resolveWaiter }
  return promise
}

export function finishTerminalLiveImeComposition(
  state: TerminalLiveImeState,
  boundary: TerminalLiveImeBoundary
): boolean {
  if (!state.owner || !isSameTerminalLiveImeBoundary(state.owner, boundary)) {
    return false
  }
  state.owner = null
  state.waiter?.resolve(true)
  state.waiter = null
  return true
}

export function invalidateTerminalLiveImeComposition(state: TerminalLiveImeState): void {
  state.owner = null
  state.waiter?.resolve(false)
  state.waiter = null
}
