import { closeAllWatchers } from '../ipc/filesystem-watcher'
import { disposeWorktreeBaseDirectoryWatchers } from '../ipc/worktree-base-directory-watcher'
import { settleTeardownWithinDeadline } from '../quit-teardown-deadline'
import { awaitRuntimeFileWatcherUnsubscribes } from '../runtime/orca-runtime-files'
import { clearRuntimeMetadataIfOwned } from '../runtime/runtime-metadata'

export type ShutdownWatcherRuntimeMetadataStartupCapability = {
  awaitRuntimeFileWatcherUnsubscribes: typeof awaitRuntimeFileWatcherUnsubscribes
  clearRuntimeMetadataIfOwned: typeof clearRuntimeMetadataIfOwned
  closeAllWatchers: typeof closeAllWatchers
  disposeWorktreeBaseDirectoryWatchers: typeof disposeWorktreeBaseDirectoryWatchers
  settleTeardownWithinDeadline: typeof settleTeardownWithinDeadline
}

export function createShutdownWatcherRuntimeMetadataStartupCapability(): ShutdownWatcherRuntimeMetadataStartupCapability {
  return {
    awaitRuntimeFileWatcherUnsubscribes,
    clearRuntimeMetadataIfOwned,
    closeAllWatchers,
    disposeWorktreeBaseDirectoryWatchers,
    settleTeardownWithinDeadline
  }
}
