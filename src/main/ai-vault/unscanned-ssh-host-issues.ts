import type { AiVaultScanIssue } from '../../shared/ai-vault-types'
import type { SshConnectionStatus } from '../../shared/ssh-types'

/** An SSH host the user owns a workspace on, so its sessions belong in an
 *  all-hosts list whether or not the connection is currently up. */
export type ExpectedSshAiVaultHost = {
  targetId: string
  label: string
  connectionStatus?: SshConnectionStatus
}

// Three offline workspace hosts must not become three banners, so each bucket
// collapses into one row and only the first few hosts are named.
const NAMED_HOST_LIMIT = 5

// 'connected' is pending too: the relay CLI bridge can still be deploying when
// the fan-out reads host infos, and that host is about to appear on its own.
const PENDING_CONNECTION_STATUSES: ReadonlySet<SshConnectionStatus> = new Set([
  'connecting',
  'deploying-relay',
  'reconnecting',
  'connected'
])

/**
 * Explains the workspace SSH hosts that contributed no leg to an all-hosts scan,
 * which otherwise just show fewer sessions with no reason given.
 *
 * Why kind 'scope' and not 'host': an offline host is a routine state, not a
 * scan failure — 'host' renders destructive AND makes the leg cache refuse to
 * store the merged result, forcing a full multi-host rescan on every panel open.
 */
export function unscannedSshHostIssues(args: {
  expectedHosts: readonly ExpectedSshAiVaultHost[]
  scannedTargetIds: ReadonlySet<string>
}): AiVaultScanIssue[] {
  const pendingLabels: string[] = []
  const offlineLabels: string[] = []
  for (const host of args.expectedHosts) {
    if (args.scannedTargetIds.has(host.targetId)) {
      continue
    }
    const bucket =
      host.connectionStatus && PENDING_CONNECTION_STATUSES.has(host.connectionStatus)
        ? pendingLabels
        : offlineLabels
    bucket.push(host.label)
  }
  const issues: AiVaultScanIssue[] = []
  if (pendingLabels.length > 0) {
    issues.push(
      unscannedHostIssue(
        `Agent sessions from ${joinHostLabels(pendingLabels)} aren't listed yet — still connecting.`
      )
    )
  }
  if (offlineLabels.length > 0) {
    issues.push(
      unscannedHostIssue(
        `Agent sessions from ${joinHostLabels(offlineLabels)} aren't listed — not connected.`
      )
    )
  }
  return issues
}

// No executionHostId: one row can stand for several hosts.
function unscannedHostIssue(message: string): AiVaultScanIssue {
  return { agent: 'codex', kind: 'scope', path: 'SSH hosts', message }
}

function joinHostLabels(labels: readonly string[]): string {
  const named = labels.slice(0, NAMED_HOST_LIMIT).join(', ')
  const remaining = labels.length - NAMED_HOST_LIMIT
  return remaining > 0 ? `${named} and ${remaining} more` : named
}
