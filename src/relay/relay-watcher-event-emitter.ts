import type { WatcherProcessEvent } from '../main/ipc/parcel-watcher-process'
import type { RelayDispatcher } from './dispatcher'

type MappedWatcherEvent = {
  kind: string
  absolutePath: string
  isDirectory?: boolean
}

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
  for (const clientId of dispatcher.activeClientIds()) {
    publishWatcherBatchToClient(dispatcher, clientId, rootPath, mapped)
  }
}

// Batches are sized to each sink's frame capacity; a batch that cannot be sized degrades to an overflow resync.
function publishWatcherBatchToClient(
  dispatcher: RelayDispatcher,
  clientId: number,
  rootPath: string,
  mapped: readonly MappedWatcherEvent[]
): void {
  const fits = (events: readonly MappedWatcherEvent[]): boolean =>
    dispatcher.producerEnvelopeBudget('fs.changed', { events }, clientId) >= 0
  const publish = (events: readonly MappedWatcherEvent[]): boolean =>
    dispatcher.publishProducerNotification(clientId, 'fs.changed', { events })

  // Fast path: the whole batch usually fits — one encode, the same cost as an unchunked emit.
  if (fits(mapped)) {
    if (!publish(mapped)) {
      emitWatcherOverflowToClient(dispatcher, clientId, rootPath)
    }
    return
  }

  let index = 0
  let size = Math.max(1, Math.ceil(mapped.length / 2))
  while (index < mapped.length) {
    size = Math.min(size, mapped.length - index)
    let chunk = mapped.slice(index, index + size)
    // Halving probe; the proven size seeds the next chunk so the walk costs ~log2(n) encodes per batch.
    let chunkFits = fits(chunk)
    while (!chunkFits && size > 1) {
      size = Math.floor(size / 2)
      chunk = mapped.slice(index, index + size)
      chunkFits = fits(chunk)
    }
    if (!chunkFits || !publish(chunk)) {
      emitWatcherOverflowToClient(dispatcher, clientId, rootPath)
      return
    }
    index += size
  }
}

// Why: the control lane — on the producer lane the marker would hit the same full queue that just
// rejected the batch and be dropped, silently desyncing the remote file tree.
function emitWatcherOverflowToClient(
  dispatcher: RelayDispatcher,
  clientId: number,
  rootPath: string
): void {
  dispatcher.notifyClient(clientId, 'fs.changed', {
    events: [{ kind: 'overflow', absolutePath: rootPath }]
  })
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
