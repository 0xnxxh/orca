import { isRecord } from './terminal-session-authority-identity'
import { failTerminalSessionAuthority } from './terminal-session-authority-mutation'
import { normalizeAgentStatusPayload } from './agent-status-types'
import { parseGitHubIssueOrPRLink } from './github-links'
import type { TerminalSideEffectFact } from './terminal-side-effect-facts'

export function assertSemanticFact(value: unknown): asserts value is TerminalSideEffectFact {
  if (!isRecord(value)) {
    failTerminalSessionAuthority('record-corrupt', 'semantic outcome fact is invalid')
  }
  if (
    ['bell', 'agent-working', 'agent-exited', '2031-subscribe', '2031-unsubscribe'].includes(
      String(value.kind)
    )
  ) {
    return
  }
  if (value.kind === 'agent-status') {
    if (!normalizeAgentStatusPayload(value.payload)) {
      failTerminalSessionAuthority('record-corrupt', 'agent status fact is invalid')
    }
    return
  }
  if (value.kind === 'title') {
    if (
      typeof value.normalizedTitle !== 'string' ||
      typeof value.rawTitle !== 'string' ||
      (value.staleWorkingTitleClear !== undefined && value.staleWorkingTitleClear !== true)
    ) {
      failTerminalSessionAuthority('record-corrupt', 'terminal title fact is invalid')
    }
    return
  }
  if (value.kind === 'agent-idle') {
    if (
      typeof value.title !== 'string' ||
      (value.staleWorkingTitleClear !== undefined && value.staleWorkingTitleClear !== true)
    ) {
      failTerminalSessionAuthority('record-corrupt', 'agent idle fact is invalid')
    }
    return
  }
  if (value.kind === 'command-finished') {
    if (value.exitCode !== null) {
      assertFactSafeInteger(value.exitCode, 'finished command exit code')
    }
    return
  }
  if (value.kind === 'pr-link') {
    const link = value.link
    if (!isRecord(link) || typeof link.url !== 'string') {
      failTerminalSessionAuthority('record-corrupt', 'pull request link fact is invalid')
    }
    const parsed = parseGitHubIssueOrPRLink(link.url)
    if (
      !parsed ||
      parsed.type !== 'pr' ||
      !hasExactKeys(link, ['url', 'slug', 'number']) ||
      !sameRepoSlug(link.slug, parsed.slug) ||
      link.number !== parsed.number
    ) {
      failTerminalSessionAuthority('record-corrupt', 'pull request link fact is invalid')
    }
    return
  }
  if (
    (value.kind === 'command-code-working' || value.kind === 'command-code-done') &&
    typeof value.prompt === 'string'
  ) {
    return
  }
  failTerminalSessionAuthority('record-corrupt', 'semantic outcome fact is invalid')
}

function assertFactSafeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    failTerminalSessionAuthority('record-corrupt', `${field} is invalid`)
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function sameRepoSlug(
  value: unknown,
  expected: Readonly<{ owner: string; repo: string; host?: string }>
): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['owner', 'repo', 'host']) &&
    value.owner === expected.owner &&
    value.repo === expected.repo &&
    value.host === expected.host
  )
}
