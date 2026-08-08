import type {
  ImportedPhysicalWorkerPtySession,
  LegacyPhysicalWorkerAuthorityRouterOptions
} from './legacy-physical-worker-authority-session'

export function acceptLegacyPhysicalWorkerUpstreamExit(
  session: ImportedPhysicalWorkerPtySession,
  code: number,
  options: LegacyPhysicalWorkerAuthorityRouterOptions,
  isDisposed: () => boolean
): void {
  if (session.exitRecording) {
    if (session.pendingExitCode !== code) {
      options.onWorkerFault?.(new Error('legacy physical worker exit code changed'))
    }
    return
  }
  session.exitRecording = true
  session.pendingExitCode = code
  if (!options.recordExit) {
    session.proxy.acceptExit({
      id: session.binding.physicalPtyId,
      incarnationId: session.binding.ptyIncarnationId,
      code
    })
    return
  }
  void options
    .recordExit(session.attachRequest, code)
    .then(() => {
      if (!session.retired && !session.exitRecorded) {
        session.proxy.acceptExit({
          id: session.binding.physicalPtyId,
          incarnationId: session.binding.ptyIncarnationId,
          code
        })
      }
    })
    .catch((error) => {
      if (!isDisposed()) {
        options.onWorkerFault?.(error instanceof Error ? error : new Error(String(error)))
      }
    })
}
