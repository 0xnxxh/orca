import { describe, expect, it } from 'vitest'
import { unscannedSshHostIssues, type ExpectedSshAiVaultHost } from './unscanned-ssh-host-issues'

const host = (
  targetId: string,
  connectionStatus?: ExpectedSshAiVaultHost['connectionStatus']
): ExpectedSshAiVaultHost => ({ targetId, label: targetId, connectionStatus })

describe('unscannedSshHostIssues', () => {
  it('explains workspace hosts that produced no leg', () => {
    const issues = unscannedSshHostIssues({
      expectedHosts: [host('dev-box', 'disconnected'), host('gpu-1')],
      scannedTargetIds: new Set()
    })

    expect(issues).toEqual([
      {
        agent: 'codex',
        kind: 'scope',
        path: 'SSH hosts',
        message: "Agent sessions from dev-box, gpu-1 aren't listed — not connected."
      }
    ])
  })

  it('omits hosts that already contributed a leg', () => {
    const issues = unscannedSshHostIssues({
      expectedHosts: [host('dev-box'), host('gpu-1')],
      scannedTargetIds: new Set(['dev-box'])
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('gpu-1')
    expect(issues[0]?.message).not.toContain('dev-box')
  })

  it.each(['connecting', 'deploying-relay', 'reconnecting', 'connected'] as const)(
    'reports %s hosts as still connecting, never as a host failure',
    (status) => {
      const issues = unscannedSshHostIssues({
        expectedHosts: [host('dev-box', status), host('gpu-1', 'auth-failed')],
        scannedTargetIds: new Set()
      })

      expect(issues.map((issue) => issue.kind)).toEqual(['scope', 'scope'])
      expect(issues[0]?.message).toBe(
        "Agent sessions from dev-box aren't listed yet — still connecting."
      )
      expect(issues[1]?.message).toBe("Agent sessions from gpu-1 aren't listed — not connected.")
    }
  )

  it('says nothing when every expected host was scanned', () => {
    expect(
      unscannedSshHostIssues({
        expectedHosts: [host('dev-box'), host('gpu-1')],
        scannedTargetIds: new Set(['dev-box', 'gpu-1'])
      })
    ).toEqual([])
  })

  it('collapses a long host list into one capped row', () => {
    const issues = unscannedSshHostIssues({
      expectedHosts: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => host(id, 'disconnected')),
      scannedTargetIds: new Set()
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toBe(
      "Agent sessions from a, b, c, d, e and 2 more aren't listed — not connected."
    )
  })
})
