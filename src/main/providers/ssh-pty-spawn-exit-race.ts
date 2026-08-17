import { isPtyIncarnationId, type PtyIncarnationId } from '../../shared/pty-incarnation'

type PendingSshPtySpawn = {
  relayPtyId?: string
  exits: {
    relayPtyId: string
    incarnationId?: PtyIncarnationId
    publish?: () => void
  }[]
}

type SshPtyPendingExitOutcome = 'exited' | 'unverifiable' | null

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

  classifyReattachExit(
    operation: PendingSshPtySpawn,
    result: { id: string; incarnationId?: PtyIncarnationId }
  ): SshPtyPendingExitOutcome {
    const sameIdExits = operation.exits.filter((exit) => exit.relayPtyId === result.id)
    if (!result.incarnationId) {
      return sameIdExits.length > 0 ? 'unverifiable' : null
    }
    const matchingExit = sameIdExits.find((exit) => exit.incarnationId === result.incarnationId)
    if (matchingExit) {
      matchingExit.publish?.()
      return 'exited'
    }
    return sameIdExits.some((exit) => !exit.incarnationId) ? 'unverifiable' : null
  }

  finish(operation: PendingSshPtySpawn): void {
    this.pending.delete(operation)
  }
}
