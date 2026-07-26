import type { AppState } from '@/store'
import { useAppStore } from '@/store'
import { inspectRuntimeTerminalProcess } from '@/runtime/runtime-terminal-inspection'
import { translate } from '@/i18n/i18n'

// Why: prompt integrations such as Starship can outlast the daemon's 300ms
// Codex fast-path timeout; account restarts must wait until the shell accepts input.
export const CODEX_ACCOUNT_RESTART_STARTUP = {
  command: 'codex',
  startupCommandDelivery: 'shell-ready'
} as const

function normalizeProcessName(processName: string | null): string | null {
  if (!processName) {
    return null
  }
  return processName.toLowerCase().replace(/\.exe$/, '')
}

function isCodexForegroundProcess(processName: string | null): boolean {
  const normalized = normalizeProcessName(processName)
  if (!normalized) {
    return false
  }
  // Why: node-pty exposes the OS foreground process name, which can be the
  // shipped Codex binary name (for example "codex-aarch64-ap" on macOS)
  // instead of the shell command the user typed. Match on a Codex prefix so
  // account-switch restart prompts still appear for real Codex sessions.
  return normalized === 'codex' || normalized.startsWith('codex-')
}

async function getLiveCodexSessionPtyIds(state: AppState): Promise<string[]> {
  const tabs = Object.values(state.tabsByWorktree).flat()
  const checks = await Promise.all(
    tabs.map(async (tab) => {
      const ptyIds = state.ptyIdsByTabId[tab.id] ?? []
      if (ptyIds.length === 0) {
        return [] as string[]
      }

      // Why: Codex sessions are not reliably discoverable from tab labels.
      // Tabs keep fallback names until a CLI emits an OSC title, and Codex
      // does not always do that. The foreground PTY process is the stable
      // source of truth for whether this live tab is actually running Codex.
      const foregroundProcesses = await Promise.all(
        ptyIds.map((ptyId) =>
          inspectRuntimeTerminalProcess(state.settings, ptyId).then(
            (inspection) => inspection.foregroundProcess,
            // Why: one stale remote pane must not hide restart notices for other confirmed Codex panes.
            () => null
          )
        )
      )
      return ptyIds.filter((_, index) => isCodexForegroundProcess(foregroundProcesses[index]))
    })
  )

  return checks.flat()
}

export async function markLiveCodexSessionsForRestart(args: {
  previousAccountLabel: string
  nextAccountLabel: string
}): Promise<void> {
  const state = useAppStore.getState()
  const liveCodexSessionPtyIds = await getLiveCodexSessionPtyIds(state)
  if (liveCodexSessionPtyIds.length === 0) {
    return
  }

  useAppStore.getState().markCodexRestartNotices(
    liveCodexSessionPtyIds.map((ptyId) => ({
      ptyId,
      previousAccountLabel: args.previousAccountLabel,
      nextAccountLabel: args.nextAccountLabel
    }))
  )
}

/**
 * Re-raises restart prompts for panes that outlived the app.
 *
 * Why: restart notices are renderer state, but the shells they describe live in
 * the PTY daemon and survive a full app restart with the old account still
 * baked into their environment. Without this, quitting Orca before restarting a
 * stale pane silently strands it on the previous account forever.
 */
export async function markRestoredStaleCodexSessionsForRestart(): Promise<void> {
  const state = useAppStore.getState()
  const liveCodexSessionPtyIds = await getLiveCodexSessionPtyIds(state)
  if (liveCodexSessionPtyIds.length === 0) {
    return
  }
  const stalePanes = await window.api.codexAccounts.listStalePanes({
    ptyIds: liveCodexSessionPtyIds
  })
  if (stalePanes.length === 0) {
    return
  }

  const resolveAccountLabel = await createCodexAccountLabelResolver()
  useAppStore.getState().markCodexRestartNotices(
    stalePanes.map((pane) => ({
      ptyId: pane.ptyId,
      previousAccountLabel: resolveAccountLabel(pane.launchAccountId),
      nextAccountLabel: resolveAccountLabel(pane.activeAccountId)
    }))
  )
}

async function createCodexAccountLabelResolver(): Promise<(accountId: string | null) => string> {
  // Why: a failed roster read still yields usable prompts — the account ids are
  // already known, only their friendly emails are missing.
  const accounts = await window.api.codexAccounts.list().catch(() => null)
  return (accountId) => {
    if (accountId == null) {
      return translate('auto.lib.codex.session.restart.4bd4a3a9c7', 'System default')
    }
    return (
      accounts?.accounts.find((account) => account.id === accountId)?.email ??
      translate('auto.lib.codex.session.restart.9f0b1c2d3e', 'Codex account')
    )
  }
}
