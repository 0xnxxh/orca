import type { WatcherProcessEvent } from '../main/ipc/parcel-watcher-process'
import { resolveRuntimePath } from '../shared/cross-platform-path'
import type { RelayDispatcher } from './dispatcher'

type MappedWatcherEvent = {
  kind: string
  absolutePath: string
  isDirectory?: boolean
}

// Why: markers ride the bounded control lane, whose overflow CLOSES the client; one outstanding marker
// per (client, root) keeps sustained backpressure from turning a recoverable resync into a link drop.
const outstandingOverflowMarkers = new WeakMap<RelayDispatcher, Set<string>>()

export function emitRelayWatcherEvents(
  dispatcher: RelayDispatcher,
  rootPath: string,
  closed: boolean,
  events: readonly WatcherProcessEvent[]
): void {
  if (closed || events.length === 0) {
    return
  }
  const mapped: MappedWatcherEvent[] = events.map((event) => ({
    kind: event.type,
    absolutePath: event.path,
    ...(event.isDirectory === undefined ? {} : { isDirectory: event.isDirectory })
  }))
  // Grouping walks every path, so only the chunking path pays for it — and only once across all clients.
  let grouped: MappedWatcherEvent[] | null = null
  const groupedByDirectory = (): MappedWatcherEvent[] =>
    (grouped ??= groupWatcherEventsByDirectory(mapped))
  for (const clientId of dispatcher.activeClientIds()) {
    publishWatcherBatchToClient(dispatcher, clientId, rootPath, mapped, groupedByDirectory)
  }
}

/**
 * Why: the renderer dedupes directory refreshes within a SINGLE fs.changed payload, so a directory
 * scattered across chunks costs one forced readDir RPC per chunk. Grouping is stable, so events for a
 * given path keep their relative order and a create-then-delete can never invert.
 */
function groupWatcherEventsByDirectory(
  mapped: readonly MappedWatcherEvent[]
): MappedWatcherEvent[] {
  const groups = new Map<string, MappedWatcherEvent[]>()
  for (const event of mapped) {
    // Runs on the remote host: derive the parent with the runtime-flavored resolver, not a '/' split.
    const parentPath = resolveRuntimePath(event.absolutePath, '..')
    const group = groups.get(parentPath)
    if (group) {
      group.push(event)
    } else {
      groups.set(parentPath, [event])
    }
  }
  return Array.from(groups.values()).flat()
}

// Batches are sized to each sink's frame capacity; a batch that cannot be sized degrades to an overflow resync.
function publishWatcherBatchToClient(
  dispatcher: RelayDispatcher,
  clientId: number,
  rootPath: string,
  mapped: readonly MappedWatcherEvent[],
  groupedByDirectory: () => readonly MappedWatcherEvent[]
): void {
  const publish = (events: readonly MappedWatcherEvent[]): boolean =>
    dispatcher.publishProducerNotification(clientId, 'fs.changed', { events })
  const budgetFor = (events: readonly MappedWatcherEvent[]): number =>
    dispatcher.producerEnvelopeBudget('fs.changed', { events }, clientId)

  // Fast path: publish the whole batch first — two encodes, the same cost as an unchunked emit.
  // logDrop:false because rejection here is a measurement, not an outcome: the batch is re-sent in
  // chunks below, so logging it would report a drop for events that all arrive.
  if (
    dispatcher.publishProducerNotification(
      clientId,
      'fs.changed',
      { events: mapped },
      {
        logDrop: false
      }
    )
  ) {
    return
  }

  // Rejection is ambiguous: an over-capacity frame is chunkable, a full producer queue is real data loss.
  const batchBudget = budgetFor(mapped)
  if (batchBudget >= 0) {
    emitWatcherOverflowToClient(dispatcher, clientId, rootPath)
    return
  }
  const eventsCapacity = budgetFor([])
  // Measured average, so the first chunk already lands near capacity instead of at half of it.
  const bytesPerEvent = (eventsCapacity - batchBudget) / mapped.length

  const grouped = groupedByDirectory()
  let index = 0
  let size = Math.max(1, Math.floor(eventsCapacity / bytesPerEvent))
  while (index < grouped.length) {
    // Why: the retention ledger covers every producer publication despite its legacy name, and admission
    // is lane-agnostic: chunks queued past its low-water reserve (half the 2 MB queue) starve interactive
    // PTY frames until pty-handler pauses every remote pane. A resync costs the user far less.
    // Per client, never dispatcher-wide: one stalled peer must not cost a healthy client a resync,
    // which forces a readDir per directory in its file tree.
    if (!dispatcher.producerRetentionBelowLowWater(clientId)) {
      emitWatcherOverflowToClient(dispatcher, clientId, rootPath)
      return
    }
    size = Math.min(size, grouped.length - index)
    let chunk = grouped.slice(index, index + size)
    let budget = budgetFor(chunk)
    while (budget < 0 && size > 1) {
      // Shrink by the measured excess rather than halving, which overshoots the byte minimum ~1.7x.
      size = Math.max(1, Math.min(size - 1, size - Math.ceil(-budget / bytesPerEvent)))
      chunk = grouped.slice(index, index + size)
      budget = budgetFor(chunk)
    }
    if (budget < 0 || !publish(chunk)) {
      emitWatcherOverflowToClient(dispatcher, clientId, rootPath)
      return
    }
    index += size
    // Re-grow into the measured headroom so one shrunk chunk cannot pin the rest of the walk below capacity.
    size += Math.floor(budget / bytesPerEvent)
  }
}

// Why: the control lane — on the producer lane the marker would hit the same full queue that just
// rejected the batch and be dropped, silently desyncing the remote file tree.
function emitWatcherOverflowToClient(
  dispatcher: RelayDispatcher,
  clientId: number,
  rootPath: string
): void {
  // Per root, never per client alone: an outstanding marker for one tree must not suppress another's resync.
  const key = `${clientId} ${rootPath}`
  const outstanding = outstandingOverflowMarkers.get(dispatcher) ?? new Set<string>()
  if (outstanding.has(key)) {
    return
  }
  outstanding.add(key)
  outstandingOverflowMarkers.set(dispatcher, outstanding)
  dispatcher.tryNotifyClient(
    clientId,
    'fs.changed',
    { events: [{ kind: 'overflow', absolutePath: rootPath }] },
    () => {
      // Settles on write, drop, or client close, so the slot can never leak.
      outstanding.delete(key)
      if (outstanding.size === 0) {
        outstandingOverflowMarkers.delete(dispatcher)
      }
    }
  )
}

export function emitRelayWatcherOverflow(
  dispatcher: RelayDispatcher,
  rootPath: string,
  closed: boolean
): void {
  if (closed) {
    return
  }
  for (const clientId of dispatcher.activeClientIds()) {
    emitWatcherOverflowToClient(dispatcher, clientId, rootPath)
  }
}
