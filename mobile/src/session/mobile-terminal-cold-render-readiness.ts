import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'

export async function settleMobileTerminalColdRenderReady(args: {
  handle: string
  revision: number
  sequence: number
  ref: TerminalWebViewHandle
  initGeneration: number
  getRevision: (handle: string) => number | null
  getSequence: (handle: string) => number | undefined
  acceptsStreamEvent: (handle: string) => boolean
  getRef: (handle: string) => TerminalWebViewHandle | null | undefined
  complete: (handle: string, revision: number) => boolean
  onTimeout: () => void
  onReady: () => void
}): Promise<boolean> {
  const renderReady = await args.ref.awaitRenderReady(args.initGeneration)
  if (
    args.getRevision(args.handle) !== args.revision ||
    args.getSequence(args.handle) !== args.sequence ||
    !args.acceptsStreamEvent(args.handle) ||
    args.getRef(args.handle) !== args.ref ||
    !args.ref.isRenderReadyGenerationCurrent(args.initGeneration)
  ) {
    return false
  }
  if (!renderReady) {
    args.onTimeout()
    return false
  }
  if (!args.complete(args.handle, args.revision)) {
    return false
  }
  args.onReady()
  return true
}
