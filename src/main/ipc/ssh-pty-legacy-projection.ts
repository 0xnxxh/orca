import { scanMode2031ReplyDecision } from '../../shared/terminal-color-scheme-protocol'
import {
  closeProjectionPty,
  getOrCreateProjectionCursor,
  projectionDebugSnapshot,
  projectionError,
  reclaimProjectionRecord,
  resetProjectionCursorForGap,
  requireProjectionRecord,
  scannerSnapshot,
  type LegacySshProjectionDebugSnapshot,
  type LegacySshProjectionReservation,
  type LegacySshProjectionSemantics,
  type ProjectionRecord,
  type PtyProjectionCursor
} from './ssh-pty-legacy-projection-record'
import {
  projectionHasOpen,
  resolveProjectionTerminality,
  SshPtyProjectionTerminality,
  unpublishedProjectionIds
} from './ssh-pty-projection-terminality'

export type {
  LegacySshProjectionIdentity,
  LegacySshProjectionReservation,
  LegacySshProjectionSemantics
} from './ssh-pty-legacy-projection-record'

export class SshPtyLegacyProjectionLedger {
  private nextId = 1
  private readonly records = new Map<string, ProjectionRecord>()
  private readonly cursorByPty = new Map<string, PtyProjectionCursor>()
  private readonly idsByPty = new Map<string, string[]>()
  private readonly terminality = new SshPtyProjectionTerminality()
  private settledCount = 0
  private transferredCount = 0
  private rolledBackCount = 0

  reserve(args: {
    ptyId: string
    providerGeneration: number
    ptyIncarnation: string
    data: string
    sequenceEnd: number
    rawLength: number
    transformed: boolean
  }): LegacySshProjectionReservation {
    const cursor = getOrCreateProjectionCursor(this.cursorByPty, args, (generation) =>
      this.transferGeneration(generation, 'provider-generation-replaced')
    )
    if (
      cursor.providerGeneration !== args.providerGeneration ||
      cursor.ptyIncarnation !== args.ptyIncarnation
    ) {
      throw projectionError('ssh_projection_stale_generation')
    }
    const scan = scanMode2031ReplyDecision(cursor.scanner, args.data)
    const projectionSemanticsId = `ssh-projection:${args.providerGeneration}:${this.nextId++}`
    const identity = Object.freeze({
      projectionSemanticsId,
      ptyId: args.ptyId,
      providerGeneration: args.providerGeneration,
      ptyIncarnation: args.ptyIncarnation,
      displayStart: cursor.displayEnd,
      displayEnd: cursor.displayEnd + args.data.length,
      sequenceEnd: args.sequenceEnd,
      rawLength: args.rawLength,
      transformed: args.transformed
    })
    const semantics = Object.freeze({
      identity,
      beforeScanner: scannerSnapshot(cursor.scanner),
      afterScanner: scannerSnapshot(scan.state),
      decision: scan.decision
    })
    this.records.set(projectionSemanticsId, {
      semantics,
      state: 'reserved',
      publishedDisplay: 0,
      publishedAccounting: 0,
      settledAccounting: 0
    })
    return Object.freeze({ semantics })
  }

  commit(reservation: LegacySshProjectionReservation): LegacySshProjectionSemantics {
    const record = requireProjectionRecord(
      this.records,
      reservation.semantics.identity.projectionSemanticsId
    )
    if (record.state !== 'reserved') {
      throw projectionError('ssh_projection_commit_invalid')
    }
    const { identity, afterScanner } = record.semantics
    const cursor = this.cursorByPty.get(identity.ptyId)
    if (
      !cursor ||
      cursor.providerGeneration !== identity.providerGeneration ||
      cursor.ptyIncarnation !== identity.ptyIncarnation ||
      cursor.displayEnd !== identity.displayStart
    ) {
      this.records.delete(identity.projectionSemanticsId)
      throw projectionError('ssh_projection_commit_stale')
    }
    cursor.displayEnd = identity.displayEnd
    cursor.scanner = { ...afterScanner }
    record.state = 'committed'
    const ids = this.idsByPty.get(identity.ptyId) ?? []
    ids.push(identity.projectionSemanticsId)
    this.idsByPty.set(identity.ptyId, ids)
    return record.semantics
  }

  rollback(reservation: LegacySshProjectionReservation): boolean {
    const id = reservation.semantics.identity.projectionSemanticsId
    const record = this.records.get(id)
    if (!record || record.state !== 'reserved') {
      return false
    }
    this.records.delete(id)
    this.rolledBackCount++
    return true
  }

  publishPrefix(ids: readonly string[], displayChars: number, accountingChars: number): void {
    let displayRemaining = Math.max(0, displayChars)
    let accountingRemaining = Math.max(0, accountingChars)
    for (const id of ids) {
      const record = this.records.get(id)
      if (!record) {
        continue
      }
      const displayLength =
        record.semantics.identity.displayEnd - record.semantics.identity.displayStart
      const unpublishedDisplay = displayLength - record.publishedDisplay
      const unpublishedAccounting = record.semantics.identity.rawLength - record.publishedAccounting
      if (displayLength === 0 && unpublishedAccounting > 0) {
        const publishAccounting = Math.min(accountingRemaining, unpublishedAccounting)
        if (publishAccounting !== unpublishedAccounting) {
          throw projectionError('ssh_projection_indivisible_split')
        }
        record.publishedAccounting += publishAccounting
        record.state = 'published'
        accountingRemaining -= publishAccounting
        continue
      }
      if (unpublishedDisplay <= 0) {
        continue
      }
      const publishDisplay = Math.min(displayRemaining, unpublishedDisplay)
      if (publishDisplay <= 0) {
        break
      }
      const indivisible = record.semantics.identity.transformed
      if (indivisible && publishDisplay !== unpublishedDisplay) {
        throw projectionError('ssh_projection_indivisible_split')
      }
      const publishAccounting =
        publishDisplay === unpublishedDisplay
          ? Math.min(accountingRemaining, unpublishedAccounting)
          : publishDisplay
      record.publishedDisplay += publishDisplay
      record.publishedAccounting += publishAccounting
      record.state = 'published'
      displayRemaining -= publishDisplay
      accountingRemaining -= publishAccounting
    }
    if (displayRemaining !== 0 || accountingRemaining !== 0) {
      throw projectionError('ssh_projection_publish_range_mismatch')
    }
  }

  settlePublishedPrefix(ptyId: string, accountingChars: number): number {
    let remaining = Math.max(0, accountingChars)
    let settled = 0
    for (const id of this.idsByPty.get(ptyId)?.slice() ?? []) {
      const record = this.records.get(id)
      if (!record) {
        continue
      }
      const available = record.publishedAccounting - record.settledAccounting
      if (available <= 0) {
        continue
      }
      const take = Math.min(remaining, available)
      record.settledAccounting += take
      settled += take
      remaining -= take
      if (
        record.settledAccounting === record.semantics.identity.rawLength &&
        record.publishedDisplay ===
          record.semantics.identity.displayEnd - record.semantics.identity.displayStart
      ) {
        this.settledCount++
        reclaimProjectionRecord(this.records, this.idsByPty, id, ptyId)
      }
      if (remaining === 0) {
        break
      }
    }
    resolveProjectionTerminality(this.terminality, this.records, this.idsByPty, ptyId)
    return settled
  }

  transfer(ids: readonly string[], _reason: string): number {
    let transferred = 0
    const touchedPtys = new Set<string>()
    for (const id of ids.slice()) {
      const record = this.records.get(id)
      if (!record || record.state === 'reserved') {
        continue
      }
      this.transferredCount++
      const ptyId = record.semantics.identity.ptyId
      reclaimProjectionRecord(this.records, this.idsByPty, id, ptyId)
      touchedPtys.add(ptyId)
      transferred++
    }
    for (const ptyId of touchedPtys) {
      resolveProjectionTerminality(this.terminality, this.records, this.idsByPty, ptyId)
    }
    return transferred
  }

  whenPtyTerminal(
    ptyId: string,
    providerGeneration: number,
    ptyIncarnation: string
  ): Promise<void> {
    return this.terminality.whenTerminal(
      ptyId,
      providerGeneration,
      ptyIncarnation,
      projectionHasOpen(this.records, this.idsByPty, ptyId)
    )
  }

  transferGeneration(providerGeneration: number, reason: string): number {
    const ids: string[] = []
    for (const [id, record] of this.records) {
      if (record.semantics.identity.providerGeneration === providerGeneration) {
        ids.push(id)
      }
    }
    return this.transfer(ids, reason)
  }

  transferPty(ptyId: string, reason: string): number {
    return this.transfer(this.idsByPty.get(ptyId) ?? [], reason)
  }

  transferUnpublishedPty(
    ptyId: string,
    providerGeneration: number,
    ptyIncarnation: string,
    reason: string
  ): number {
    const ids = unpublishedProjectionIds(
      this.records,
      this.idsByPty.get(ptyId) ?? [],
      providerGeneration,
      ptyIncarnation
    )
    return this.transfer(ids, reason)
  }

  closePty(
    ptyId: string,
    providerGeneration: number,
    ptyIncarnation: string,
    reason: string
  ): void {
    closeProjectionPty(this.cursorByPty, ptyId, providerGeneration, ptyIncarnation, () => {
      this.transferPty(ptyId, reason)
      this.idsByPty.delete(ptyId)
    })
  }

  closeGeneration(providerGeneration: number, reason: string): void {
    for (const [id, record] of this.records) {
      if (record.semantics.identity.providerGeneration !== providerGeneration) {
        continue
      }
      if (record.state === 'reserved') {
        this.records.delete(id)
        this.rolledBackCount++
      } else {
        this.transfer([id], reason)
      }
    }
    for (const [ptyId, cursor] of this.cursorByPty) {
      if (cursor.providerGeneration === providerGeneration) {
        this.cursorByPty.delete(ptyId)
        this.idsByPty.delete(ptyId)
      }
    }
  }

  resetForGap(ptyId: string): void {
    resetProjectionCursorForGap(this.cursorByPty, ptyId)
  }

  get(id: string): LegacySshProjectionSemantics | undefined {
    return this.records.get(id)?.semantics
  }

  getDebugSnapshot(): LegacySshProjectionDebugSnapshot {
    return projectionDebugSnapshot(this.records, this.cursorByPty, {
      settled: this.settledCount,
      transferred: this.transferredCount,
      rolledBack: this.rolledBackCount
    })
  }
}
