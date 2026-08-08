import type { ImportedPhysicalWorkerPtySession } from './legacy-physical-worker-authority-session'

export function ensureLegacyPhysicalWorkerAckDrain(
  session: ImportedPhysicalWorkerPtySession,
  onDrained: () => void,
  onFault: (error: Error) => void
): void {
  if (session.ackTask || session.retired) {
    return
  }
  const operation = drainLegacyPhysicalWorkerAcks(session)
  session.ackTask = operation
  void operation
    .then(onDrained)
    .catch((error) => onFault(error instanceof Error ? error : new Error(String(error))))
    .finally(() => {
      if (session.ackTask === operation) {
        session.ackTask = null
      }
      if (
        !session.retired &&
        session.route.isCurrent() &&
        session.requestedAckEndSu > session.proxy.snapshot().downstreamAckedEndSu
      ) {
        ensureLegacyPhysicalWorkerAckDrain(session, onDrained, onFault)
      }
    })
}

async function drainLegacyPhysicalWorkerAcks(
  session: ImportedPhysicalWorkerPtySession
): Promise<void> {
  while (!session.retired && session.route.isCurrent()) {
    const targetEndSu = session.requestedAckEndSu
    await session.proxy.acknowledgeDownstream(targetEndSu)
    if (targetEndSu >= session.requestedAckEndSu) {
      return
    }
  }
}
