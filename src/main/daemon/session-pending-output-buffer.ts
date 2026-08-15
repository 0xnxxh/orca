import type { PendingOutputRecord } from './types'

// Why: bounds in-memory pending output when no client drains it; past the cap we drop records and flag
// overflow so the next take falls back to one full snapshot. UTF-16 units; worst-case wire is ~6x, under NDJSON_MAX_LINE_BYTES (16MB).
export const PENDING_OUTPUT_MAX_BYTES = 2 * 1024 * 1024

export type PendingOutputDrain = {
  records: PendingOutputRecord[]
  overflowed: boolean
  seq: number
}

/** Bounded, coalescing buffer of records awaiting a client drain. */
export class PendingOutputBuffer {
  private pendingOutputRecords: PendingOutputRecord[] = []
  private pendingOutputBytes = 0
  private pendingOutputOverflowed = false
  private pendingOutputSeq = 0

  record(record: PendingOutputRecord): void {
    if (this.pendingOutputOverflowed) {
      return
    }
    const bytes = record.kind === 'output' ? record.data.length : 8
    if (this.pendingOutputBytes + bytes > PENDING_OUTPUT_MAX_BYTES) {
      this.pendingOutputRecords = []
      this.pendingOutputBytes = 0
      this.pendingOutputOverflowed = true
      return
    }
    // Why: coalesce the thousands of tiny TUI chunks per tick to keep take RPC/log frames compact; 64KB cap bounds append cost.
    const last = this.pendingOutputRecords.at(-1)
    if (record.kind === 'output' && last?.kind === 'output' && last.data.length < 64 * 1024) {
      last.data += record.data
    } else {
      this.pendingOutputRecords.push(record)
    }
    this.pendingOutputBytes += bytes
  }

  drain(includeSnapshot: boolean): PendingOutputDrain {
    const records = this.pendingOutputRecords
    const overflowed = this.pendingOutputOverflowed
    this.pendingOutputRecords = []
    this.pendingOutputBytes = 0
    this.pendingOutputOverflowed = false
    // Empty incremental takes are not persisted; advancing them would create a false reattach gap.
    if (includeSnapshot || records.length > 0 || overflowed) {
      this.pendingOutputSeq += 1
    }
    return { records, overflowed, seq: this.pendingOutputSeq }
  }
}
