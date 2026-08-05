import type { RpcClient } from '../transport/rpc-client'
import { activateMobileSessionTab } from '../session/mobile-session-tab-activation'

type ActivationClient = Pick<RpcClient, 'sendRequest'>

type DiffTabCandidate = {
  id: string
  type: string
  mode?: unknown
  relativePath?: unknown
  diffSource?: unknown
}

type Options = {
  client: ActivationClient
  worktreeId: string
  relativePath: string
  staged: boolean
  onOpenedFileDiff?: (relativePath: string) => void
  isCurrent?: () => boolean
}

export type MobileSourceControlSessionDiffRevealResult = 'revealed' | 'cancelled' | 'timeout'

const TAB_POLL_DELAYS_MS = [0, 300, 600, 900] as const

export async function revealMobileSourceControlSessionDiff(
  options: Options
): Promise<MobileSourceControlSessionDiffRevealResult> {
  if (options.onOpenedFileDiff) {
    options.onOpenedFileDiff(options.relativePath)
    return 'revealed'
  }

  for (const delayMs of TAB_POLL_DELAYS_MS) {
    await waitForDelay(delayMs)
    if (options.isCurrent?.() === false) {
      return 'cancelled'
    }

    const tab = await findOpenedDiffTab(options)
    if (options.isCurrent?.() === false) {
      return 'cancelled'
    }
    if (!tab) {
      continue
    }

    const activated = await activateDiffTab(options, tab.id)
    if (options.isCurrent?.() === false) {
      return 'cancelled'
    }
    if (activated) {
      return 'revealed'
    }
  }

  return 'timeout'
}

async function findOpenedDiffTab(options: Options): Promise<DiffTabCandidate | null> {
  try {
    const response = await options.client.sendRequest('session.tabs.list', {
      worktree: `id:${options.worktreeId}`
    })
    if (!response.ok) {
      return null
    }
    const snapshot = readTabSnapshot(response.result)
    if (!snapshot) {
      return null
    }

    const source = options.staged ? 'staged' : 'unstaged'
    const matches = snapshot.tabs.filter(
      (tab) =>
        tab.type !== 'browser' &&
        tab.type !== 'terminal' &&
        tab.mode === 'diff' &&
        tab.relativePath === options.relativePath
    )
    return (
      matches.find((tab) => tab.diffSource === source) ??
      matches.find((tab) => tab.diffSource == null) ??
      null
    )
  } catch {
    return null
  }
}

async function activateDiffTab(options: Options, tabId: string): Promise<boolean> {
  try {
    const response = await activateMobileSessionTab(options.client, {
      worktree: `id:${options.worktreeId}`,
      tabId,
      notifyClients: false,
      navigation: 'caller',
      intent: 'user'
    })
    return response.ok && readActiveTabId(response.result) === tabId
  } catch {
    return false
  }
}

function readTabSnapshot(value: unknown): { tabs: DiffTabCandidate[] } | null {
  if (!isRecord(value) || !Array.isArray(value.tabs) || !value.tabs.every(isDiffTabCandidate)) {
    return null
  }
  return { tabs: value.tabs }
}

function isDiffTabCandidate(value: unknown): value is DiffTabCandidate {
  return isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string'
}

function readActiveTabId(value: unknown): string | null {
  return isRecord(value) && typeof value.activeTabId === 'string' ? value.activeTabId : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function waitForDelay(delayMs: number): Promise<void> {
  if (delayMs === 0) {
    return
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}
