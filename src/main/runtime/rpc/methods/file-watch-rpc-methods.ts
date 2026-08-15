import { defineMethod, defineStreamingMethod, type RpcAnyMethod } from '../core'
import { runFileWatchStream } from './file-watch-stream-lifecycle'
import { FileUnwatch, WorktreeSelector } from './files-params'

let filesWatchSubscriptionSeq = 0

export const FILE_WATCH_METHODS: RpcAnyMethod[] = [
  defineStreamingMethod({
    name: 'files.watch',
    params: WorktreeSelector,
    handler: async (params, { runtime, connectionId, signal }, emit) => {
      const seq = ++filesWatchSubscriptionSeq
      const subscriptionId = `files-watch-${connectionId ?? 'inproc'}-${seq}`
      await runFileWatchStream({
        runtime,
        worktree: params.worktree,
        connectionId,
        signal,
        subscriptionId,
        emit
      })
    }
  }),
  defineMethod({
    name: 'files.unwatch',
    params: FileUnwatch,
    handler: async (params, { runtime }) => {
      await runtime.cleanupSubscriptionAndWait(params.subscriptionId)
      return { unsubscribed: true }
    }
  })
]
