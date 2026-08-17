import { isPtyIncarnationId, type PtyIncarnationId } from '../../shared/pty-incarnation'

type PendingSshPtySpawn = {
  relayPtyId?: string
  exits: {
    relayPtyId: string
    incarnationId?: PtyIncarnationId
    publish?: () => void
  }[]
}

export class SshPtySpawnExitRaceTracker {
  private pending = new Set<PendingSshPtySpawn>()

  begin(relayPtyId?: string): PendingSshPtySpawn {
    const operation = { ...(relayPtyId ? { relayPtyId } : {}), exits: [] }
    this.pending.add(operation)
    return operation
  }

  recordExit(relayPtyId: string, incarnationId: unknown, publish?: () => void): boolean {
    let quarantined = false
    let published = false
    const publishOnce = (): void => {
      if (!published) {
        published = true
        publish?.()
      }
    }
    for (const operation of this.pending) {
      const quarantine = operation.relayPtyId === relayPtyId && publish !== undefined
      operation.exits.push({
        relayPtyId,
        ...(isPtyIncarnationId(incarnationId) ? { incarnationId } : {}),
        ...(quarantine ? { publish: publishOnce } : {})
      })
      quarantined ||= quarantine
    }
    return quarantined
  }

  didMatchingExitArrive(
    operation: PendingSshPtySpawn,
    result: { id: string; incarnationId?: PtyIncarnationId }
  ): boolean {
    const matchingExit = operation.exits.find(
      (exit) =>
        exit.relayPtyId === result.id &&
        (!result.incarnationId || exit.incarnationId === result.incarnationId)
    )
    matchingExit?.publish?.()
    return matchingExit !== undefined
  }

  finish(operation: PendingSshPtySpawn): void {
    this.pending.delete(operation)
  }
}
