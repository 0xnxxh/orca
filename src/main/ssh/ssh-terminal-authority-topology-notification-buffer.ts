import {
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_BUFFERED_BYTES,
  TERMINAL_AUTHORITY_TOPOLOGY_MAX_BUFFERED_CHANGES,
  type TerminalAuthorityTopologyChange,
  type TerminalAuthorityTopologySnapshot
} from '../../shared/terminal-authority-topology-stream-contract'
import type {
  SshTerminalAuthorityTopologyReducer,
  SshTerminalAuthorityTopologyResnapshotReason
} from './ssh-terminal-authority-topology-reducer'

export type SshTerminalAuthorityTopologyBufferedNotification =
  | Readonly<{
      kind: 'change'
      ordinal: number
      byteLength: number
      change: TerminalAuthorityTopologyChange
    }>
  | Readonly<{ kind: 'invalid'; ordinal: number; byteLength: 0 }>

export type SshTerminalAuthorityTopologyBufferedBatch = Readonly<{
  notifications: readonly SshTerminalAuthorityTopologyBufferedNotification[]
  overflowOrdinal: number
}>

export class SshTerminalAuthorityTopologyNotificationBuffer {
  private notifications: SshTerminalAuthorityTopologyBufferedNotification[] = []
  private retainedBytes = 0
  private overflowOrdinal = 0

  push(notification: SshTerminalAuthorityTopologyBufferedNotification): void {
    if (this.overflowOrdinal > 0) {
      this.overflowOrdinal = notification.ordinal
      return
    }
    if (
      this.notifications.length >= TERMINAL_AUTHORITY_TOPOLOGY_MAX_BUFFERED_CHANGES ||
      this.retainedBytes + notification.byteLength > TERMINAL_AUTHORITY_TOPOLOGY_MAX_BUFFERED_BYTES
    ) {
      this.notifications = []
      this.retainedBytes = 0
      this.overflowOrdinal = notification.ordinal
      return
    }
    this.notifications.push(notification)
    this.retainedBytes += notification.byteLength
  }

  take(): SshTerminalAuthorityTopologyBufferedBatch {
    const batch = Object.freeze({
      notifications: Object.freeze(this.notifications),
      overflowOrdinal: this.overflowOrdinal
    })
    this.clear()
    return batch
  }

  clear(): void {
    this.notifications = []
    this.retainedBytes = 0
    this.overflowOrdinal = 0
  }
}

export function replaySshTerminalAuthorityTopologyNotifications(args: {
  reducer: SshTerminalAuthorityTopologyReducer
  snapshot: TerminalAuthorityTopologySnapshot
  notifications: readonly SshTerminalAuthorityTopologyBufferedNotification[]
  overflowOrdinal: number
}): SshTerminalAuthorityTopologyResnapshotReason | null {
  if (args.overflowOrdinal > 0) {
    return 'buffer-capacity'
  }
  for (const entry of args.notifications) {
    if (entry.kind === 'invalid') {
      return 'notification-invalid'
    }
    if (entry.change.streamIncarnationId !== args.snapshot.streamIncarnationId) {
      if (entry.change.writerEpoch < args.snapshot.writerEpoch) {
        continue
      }
      return 'stream-incarnation-changed'
    }
    const result = args.reducer.apply(entry.change)
    if (result.kind === 'resnapshot-required') {
      return result.reason
    }
  }
  return null
}
