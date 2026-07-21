import { describe, expect, it } from 'vitest'
import {
  findTrustedCodexSessionResume,
  resolveTrustedCodexSessionResumeHome
} from './codex-session-resume-home'

describe('resolveTrustedCodexSessionResumeHome', () => {
  it('returns the trusted home containing a persisted rollout', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl',
        trustedCodexHomes: ['/managed/account/home', '/Users/example/.codex'],
        fileExists: () => true
      })
    ).toBe('/Users/example/.codex')
  })

  it('accepts Windows paths case-insensitively', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: 'C:\\Users\\Example\\.codex\\sessions\\2026\\07\\20\\rollout-a.jsonl',
        trustedCodexHomes: ['c:\\users\\example\\.codex'],
        fileExists: () => true
      })
    ).toBe('c:\\users\\example\\.codex')
  })

  it('rejects paths outside trusted homes or outside the rollout layout', () => {
    const fileExists = (): boolean => true
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/tmp/sessions/2026/07/20/rollout-a.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileExists
      })
    ).toBeNull()
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/index.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileExists
      })
    ).toBeNull()
  })

  it('rejects a trusted-looking path when the rollout no longer exists', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/2026/07/20/rollout-a.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileExists: () => false
      })
    ).toBeNull()
  })

  it('finds older saved sessions by id when transcript provenance is absent', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const rolloutPath = `/managed/account/home/sessions/2026/07/20/rollout-2026-07-20T15-50-19-${sessionId}.jsonl`
    const listSessionFiles = async function* (sessionsRoot: string): AsyncIterable<string> {
      if (sessionsRoot === '/managed/account/home/sessions') {
        yield rolloutPath
      }
    }

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: ['/Users/example/.codex', '/managed/account/home'],
        listSessionFiles
      })
    ).resolves.toEqual({ homePath: '/managed/account/home', transcriptPath: rolloutPath })
  })

  it('does not scan homes for an untrusted legacy session id shape', async () => {
    const listSessionFiles = (): AsyncIterable<string> => {
      throw new Error('must not scan')
    }
    await expect(
      findTrustedCodexSessionResume({
        sessionId: '../session',
        transcriptPath: undefined,
        trustedCodexHomes: ['/Users/example/.codex'],
        listSessionFiles
      })
    ).resolves.toBeNull()
  })
})
