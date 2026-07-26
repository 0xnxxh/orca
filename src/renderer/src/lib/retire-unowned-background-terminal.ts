import { useAppStore } from '@/store'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { isTerminalTabPresent } from '@/store/slices/terminal-tab-retirement'

export async function retireUnownedTerminal(args: {
  /** Present tab id, or `{ worktreeId }` for a launch whose tab is created after the spawn. */
  owner: { tabId: string } | { worktreeId: string }
  ptyId: string
  runtimeTarget: RuntimeClientTarget
  runtimeTerminalHandle?: string | null
  onRetire?: () => void
}): Promise<boolean> {
  const state = useAppStore.getState()
  const owner = args.owner
  const isOwned =
    'tabId' in owner
      ? isTerminalTabPresent(state, owner.tabId)
      : // Why: getKnownWorktreeById, not allWorktrees() — the latter reads only
        // worktreesByRepo and would report every folder workspace as gone,
        // killing its agent PTY the instant the spawn resolves.
        state.getKnownWorktreeById(owner.worktreeId) !== undefined
  if (isOwned) {
    return false
  }
  // Why: close can win while provider creation is in flight, before the
  // returned handle is bindable to store state or visible to tab retirement.
  args.onRetire?.()
  await retireProvider(args)
  return true
}

export async function retireProvider(args: {
  ptyId: string
  runtimeTarget: RuntimeClientTarget
  runtimeTerminalHandle?: string | null
}): Promise<void> {
  try {
    if (args.runtimeTarget.kind === 'environment' && args.runtimeTerminalHandle) {
      await callRuntimeRpc(args.runtimeTarget, 'terminal.close', {
        terminal: args.runtimeTerminalHandle
      })
    } else if (args.runtimeTarget.kind === 'local') {
      await window.api.pty.kill(args.ptyId)
    }
  } catch {
    // Best-effort provider teardown; the retired tab must not be recreated.
  }
}
