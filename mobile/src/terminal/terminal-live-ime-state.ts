export type TerminalLiveImeBoundary = {
  readonly generation: number
  readonly handle: string
}

type TerminalLiveImeOwner = TerminalLiveImeBoundary & {
  readonly epoch: number
}

type TerminalLiveImeWaiter = {
  readonly owner: TerminalLiveImeOwner
  readonly promise: Promise<boolean>
  readonly resolve: (committed: boolean) => void
}

export type TerminalLiveImeState = {
  epoch: number
  owner: TerminalLiveImeOwner | null
  waiter: TerminalLiveImeWaiter | null
}

export function createTerminalLiveImeState(): TerminalLiveImeState {
  return { epoch: 0, owner: null, waiter: null }
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
  state.epoch += 1
  state.owner = { ...boundary, epoch: state.epoch }
}

function isSameTerminalLiveImeOwner(
  left: TerminalLiveImeOwner,
  right: TerminalLiveImeOwner
): boolean {
  return left.epoch === right.epoch && isSameTerminalLiveImeBoundary(left, right)
}

export function waitForTerminalLiveImeComposition(
  state: TerminalLiveImeState,
  boundary: TerminalLiveImeBoundary
): Promise<boolean> | null {
  if (!state.owner || !isSameTerminalLiveImeBoundary(state.owner, boundary)) {
    return null
  }
  if (state.waiter && isSameTerminalLiveImeOwner(state.waiter.owner, state.owner)) {
    return state.waiter.promise
  }
  let resolveWaiter: (committed: boolean) => void = () => undefined
  const promise = new Promise<boolean>((resolve) => {
    resolveWaiter = resolve
  })
  state.waiter = { owner: state.owner, promise, resolve: resolveWaiter }
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
