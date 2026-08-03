export type TerminalLiveComposition = {
  readonly completion: Promise<boolean>
  readonly handle: string
  readonly resolve: (committed: boolean) => void
}

export type TerminalLiveCompositionChangeEvent = {
  readonly nativeEvent: {
    readonly isComposing?: boolean
    readonly text: string
  }
}

export function createTerminalLiveComposition(handle: string): TerminalLiveComposition {
  let resolveCompletion: (committed: boolean) => void = () => undefined
  const completion = new Promise<boolean>((resolve) => {
    resolveCompletion = resolve
  })
  return { completion, handle, resolve: resolveCompletion }
}
