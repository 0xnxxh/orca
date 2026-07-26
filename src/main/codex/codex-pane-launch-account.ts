import type { GlobalSettings } from '../../shared/types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import {
  getCodexSelectionLaneKey,
  getCodexSelectionTargetForAccount,
  getSelectedCodexAccountIdForTarget,
  type CodexAccountSelectionTarget
} from '../codex-accounts/runtime-selection'
import type { CodexPaneAccountRecord } from './codex-pane-account-registry'

type CodexPaneLaunchAccountSettings = Pick<
  GlobalSettings,
  'activeCodexManagedAccountId' | 'activeCodexManagedAccountIdsByRuntime' | 'codexManagedAccounts'
>

/**
 * Resolves which Codex account a PTY is actually launching under.
 *
 * Why: an automatic session resume deliberately pins CODEX_HOME to the home
 * that owns the session rather than to the current selection, so a cold-restored
 * pane can come back on an account the user already switched away from. Naming
 * that real account — instead of the selection Orca ignored — is what lets the
 * restart prompt tell the user which account the pane is stuck on.
 *
 * Returns null when the launch cannot be attributed, which keeps the pane out of
 * the stale-pane report entirely.
 */
export function resolveCodexPaneLaunchAccount(args: {
  pinnedByResume: boolean
  launchCodexHomePath: string | null
  systemCodexHomePath: string
  settings: CodexPaneLaunchAccountSettings
  target: CodexAccountSelectionTarget
}): CodexPaneAccountRecord | null {
  const selectionKey = getCodexSelectionLaneKey(args.target)
  if (!args.pinnedByResume) {
    return {
      selectionKey,
      accountId: getSelectedCodexAccountIdForTarget(args.settings, args.target)
    }
  }
  const accountId = resolveCodexHomeOwnerAccountId(args)
  return accountId === undefined ? null : { selectionKey, accountId }
}

/** undefined when no account owns the home; null means the system-default account. */
function resolveCodexHomeOwnerAccountId(args: {
  launchCodexHomePath: string | null
  systemCodexHomePath: string
  settings: CodexPaneLaunchAccountSettings
  target: CodexAccountSelectionTarget
}): string | null | undefined {
  // Why: no injected CODEX_HOME means Codex reads the user's own home.
  if (!args.launchCodexHomePath) {
    return null
  }
  const launchHome = normalizeRuntimePathForComparison(args.launchCodexHomePath)
  if (launchHome === normalizeRuntimePathForComparison(args.systemCodexHomePath)) {
    return null
  }
  const laneKey = getCodexSelectionLaneKey(args.target)
  const owner = args.settings.codexManagedAccounts?.find(
    (account) =>
      // Why: a WSL pane resolves its account from its own per-distro lane, so a
      // host account's home must never answer for it (and vice versa).
      getCodexSelectionLaneKey(getCodexSelectionTargetForAccount(account)) === laneKey &&
      normalizeRuntimePathForComparison(account.managedHomePath) === launchHome
  )
  // Why: the shared runtime mirror hot-swaps to whichever account is selected, so
  // an unattributable home is no evidence the pane is on a different one. A
  // wrong restart notice silently drops every keystroke in that terminal.
  return owner ? owner.id : undefined
}
