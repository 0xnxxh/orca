import type { TerminalWebViewHandle } from '../terminal/terminal-webview-contract'

type InitialViewportWebView = Pick<
  TerminalWebViewHandle,
  'awaitRenderReady' | 'isRenderReadyGenerationCurrent' | 'measureFitDimensions'
>

export async function resubscribeMobileTerminalAfterInitialViewport(args: {
  handle: string
  sequence: number
  initGeneration: number
  frameHeight: number
  getSequence: (handle: string) => number | undefined
  getRef: (handle: string) => InitialViewportWebView | null | undefined
  onMeasured: (
    dimensions: NonNullable<Awaited<ReturnType<TerminalWebViewHandle['measureFitDimensions']>>>
  ) => void
}): Promise<void> {
  const ref = args.getRef(args.handle)
  if (
    !ref ||
    !(await ref.awaitRenderReady(args.initGeneration)) ||
    !ref.isRenderReadyGenerationCurrent(args.initGeneration) ||
    args.getSequence(args.handle) !== args.sequence ||
    args.getRef(args.handle) !== ref
  ) {
    return
  }
  const dimensions = await ref.measureFitDimensions(args.frameHeight || undefined)
  if (
    !ref.isRenderReadyGenerationCurrent(args.initGeneration) ||
    args.getSequence(args.handle) !== args.sequence ||
    args.getRef(args.handle) !== ref ||
    !dimensions
  ) {
    return
  }
  args.onMeasured(dimensions)
}
