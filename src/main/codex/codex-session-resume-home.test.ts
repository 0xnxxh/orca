import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimsCodexRolloutLayout,
  findTrustedCodexSessionResume,
  resolveTrustedCodexSessionResumeHome
} from './codex-session-resume-home'

const tempRoots: string[] = []

// Why: the ranking inputs are required by design; cases below that never reach the rescan stay neutral.
const withoutHomeRanking = {
  getSelectedAccountCodexHome: (): string | null => null,
  systemCodexHomePath: null
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveTrustedCodexSessionResumeHome', () => {
  it('returns the trusted home containing a persisted rollout', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl',
        trustedCodexHomes: ['/managed/account/home', '/Users/example/.codex'],
        fileIsRegular: () => true
      })
    ).toBe('/Users/example/.codex')
  })

  it('accepts Windows paths case-insensitively', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: 'C:\\Users\\Example\\.codex\\sessions\\2026\\07\\20\\rollout-a.jsonl',
        trustedCodexHomes: ['c:\\users\\example\\.codex'],
        fileIsRegular: () => true
      })
    ).toBe('c:\\users\\example\\.codex')
  })

  it('rejects paths outside trusted homes or outside the rollout layout', () => {
    const fileIsRegular = vi.fn((): boolean => true)
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/tmp/sessions/2026/07/20/rollout-a.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular
      })
    ).toBeNull()
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/index.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular
      })
    ).toBeNull()
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath:
          '/Users/example/.codex/sessions/2026/07/20/rollout-a/../../../../outside.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular
      })
    ).toBeNull()
    expect(fileIsRegular).not.toHaveBeenCalled()
  })

  it('rejects a trusted-looking path when the rollout no longer exists', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/2026/07/20/rollout-a.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular: () => false
      })
    ).toBeNull()
  })

  it('requires the transcript provenance to name a regular rollout file', () => {
    const homePath = mkdtempSync(join(tmpdir(), 'orca-codex-resume-home-'))
    tempRoots.push(homePath)
    const rolloutDirectory = join(homePath, 'sessions', '2026', '07', '20', 'rollout-a.jsonl')
    mkdirSync(rolloutDirectory, { recursive: true })

    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: rolloutDirectory,
        trustedCodexHomes: [homePath]
      })
    ).toBeNull()

    const rolloutFile = join(homePath, 'sessions', '2026', '07', '20', 'rollout-b.jsonl')
    writeFileSync(rolloutFile, '{}\n')
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: rolloutFile,
        trustedCodexHomes: [homePath]
      })
    ).toBe(homePath)
  })

  it('follows Codex when a persisted plain rollout was compressed in place', async () => {
    const homePath = mkdtempSync(join(tmpdir(), 'orca-codex-resume-home-'))
    tempRoots.push(homePath)
    const plainPath = join(
      homePath,
      'sessions',
      '2026',
      '07',
      '20',
      'rollout-2026-07-20T12-00-00-session.jsonl'
    )
    const compressedPath = `${plainPath}.zst`
    mkdirSync(join(plainPath, '..'), { recursive: true })
    writeFileSync(compressedPath, 'compressed-rollout')

    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'session-a',
        transcriptPath: plainPath,
        trustedCodexHomes: [homePath],
        ...withoutHomeRanking
      })
    ).resolves.toEqual({ homePath, transcriptPath: compressedPath })

    writeFileSync(plainPath, 'active-rollout')
    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'session-a',
        transcriptPath: compressedPath,
        trustedCodexHomes: [homePath],
        ...withoutHomeRanking
      })
    ).resolves.toEqual({ homePath, transcriptPath: plainPath })
  })

  it('finds compressed rollouts for legacy records without transcript provenance', async () => {
    const homePath = mkdtempSync(join(tmpdir(), 'orca-codex-resume-home-'))
    tempRoots.push(homePath)
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const compressedPath = join(
      homePath,
      'sessions',
      '2026',
      '07',
      '20',
      `rollout-2026-07-20T12-00-00-${sessionId}.jsonl.zst`
    )
    mkdirSync(join(compressedPath, '..'), { recursive: true })
    writeFileSync(compressedPath, 'compressed-rollout')

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: [homePath],
        ...withoutHomeRanking
      })
    ).resolves.toEqual({ homePath, transcriptPath: compressedPath })
  })

  it('finds older saved sessions by id when transcript provenance is absent', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const rolloutPath = `/managed/account/home/sessions/2026/07/20/rollout-2026-07-20T15-50-19-${sessionId}.jsonl`
    const listSessionFiles = async function* (sessionsRoot: string): AsyncIterable<string> {
      if (sessionsRoot === '/managed/account/home/sessions') {
        yield `/managed/account/home/sessions/misplaced-${sessionId}.jsonl`
        yield rolloutPath
      }
    }

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: ['/Users/example/.codex', '/managed/account/home'],
        ...withoutHomeRanking,
        listSessionFiles
      })
    ).resolves.toEqual({ homePath: '/managed/account/home', transcriptPath: rolloutPath })
  })

  it('does not scan session trees when exact transcript provenance is valid', async () => {
    const transcriptPath =
      '/managed/account/home/sessions/2026/07/20/rollout-2026-07-20-session.jsonl'
    const listSessionFiles = vi.fn((): AsyncIterable<string> => {
      throw new Error('must not scan')
    })

    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'session-a',
        transcriptPath,
        trustedCodexHomes: ['/managed/account/home'],
        ...withoutHomeRanking,
        fileIsRegular: () => true,
        listSessionFiles
      })
    ).resolves.toEqual({ homePath: '/managed/account/home', transcriptPath })
    expect(listSessionFiles).not.toHaveBeenCalled()
  })

  it('does not replace rejected transcript provenance with a same-id rollout from another home', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const listSessionFiles = vi.fn((): AsyncIterable<string> => {
      throw new Error('must not scan')
    })

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: `/managed/origin/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`,
        trustedCodexHomes: ['/managed/origin/home', '/managed/other/home'],
        ...withoutHomeRanking,
        fileIsRegular: () => false,
        listSessionFiles
      })
    ).resolves.toBeNull()
    expect(listSessionFiles).not.toHaveBeenCalled()
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
        ...withoutHomeRanking,
        listSessionFiles
      })
    ).resolves.toBeNull()
  })
})

describe('findTrustedCodexSessionResume legacy-rescan home ranking', () => {
  const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
  const systemHome = join('/Users', 'example', '.codex')
  const sharedMirror = join('/userData', 'codex-runtime-home', 'home')
  const accountAHome = join('/userData', 'codex-accounts', 'account-a', 'home')
  const accountBHome = join('/userData', 'codex-accounts', 'account-b', 'home')

  const rolloutIn = (homePath: string): string =>
    join(homePath, 'sessions', '2026', '07', '20', `rollout-2026-07-20T15-50-19-${sessionId}.jsonl`)

  // Why: PR #10770 hardlinks one rollout into every managed home, so the id alone stops naming an account.
  const listRolloutInEveryHome = async function* (sessionsRoot: string): AsyncIterable<string> {
    yield join(sessionsRoot, '2026', '07', '20', `rollout-2026-07-20T15-50-19-${sessionId}.jsonl`)
  }

  const listRolloutIn = (...homePaths: string[]) =>
    async function* (sessionsRoot: string): AsyncIterable<string> {
      if (homePaths.some((homePath) => sessionsRoot === join(homePath, 'sessions'))) {
        yield* listRolloutInEveryHome(sessionsRoot)
      }
    }

  it('resumes into the selected account home whatever order the homes arrive in', async () => {
    for (const trustedCodexHomes of [
      [systemHome, sharedMirror, accountAHome, accountBHome],
      [systemHome, sharedMirror, accountBHome, accountAHome],
      [accountBHome, accountAHome, sharedMirror, systemHome]
    ]) {
      await expect(
        findTrustedCodexSessionResume({
          sessionId,
          transcriptPath: undefined,
          trustedCodexHomes,
          getSelectedAccountCodexHome: () => accountBHome,
          systemCodexHomePath: systemHome,
          listSessionFiles: listRolloutInEveryHome
        })
      ).resolves.toEqual({ homePath: accountBHome, transcriptPath: rolloutIn(accountBHome) })
    }
  })

  it('falls back to the real system home when no account home is selected', async () => {
    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: [sharedMirror, accountAHome, systemHome],
        getSelectedAccountCodexHome: () => null,
        systemCodexHomePath: systemHome,
        listSessionFiles: listRolloutInEveryHome
      })
    ).resolves.toEqual({ homePath: systemHome, transcriptPath: rolloutIn(systemHome) })
  })

  it('orders the remaining homes by path so insertion order never decides', async () => {
    for (const trustedCodexHomes of [
      [accountBHome, sharedMirror, accountAHome],
      [accountAHome, accountBHome, sharedMirror]
    ]) {
      await expect(
        findTrustedCodexSessionResume({
          sessionId,
          transcriptPath: undefined,
          trustedCodexHomes,
          getSelectedAccountCodexHome: () => null,
          systemCodexHomePath: systemHome,
          listSessionFiles: listRolloutInEveryHome
        })
      ).resolves.toEqual({ homePath: accountAHome, transcriptPath: rolloutIn(accountAHome) })
    }
  })

  it('prefers a per-account home over the shared mirror when the system home lacks the id', async () => {
    // Why: 'codex-accounts' sorts before 'codex-runtime-home', so tier 3 flips the pre-ranking
    // winner here. Deliberate: the mirror is hot-swapped and names no account, the account home does.
    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: [systemHome, sharedMirror, accountAHome],
        getSelectedAccountCodexHome: () => null,
        systemCodexHomePath: systemHome,
        listSessionFiles: listRolloutIn(sharedMirror, accountAHome)
      })
    ).resolves.toEqual({ homePath: accountAHome, transcriptPath: rolloutIn(accountAHome) })
  })

  it('ranks Windows homes case-insensitively and keeps the caller path spelling', async () => {
    const windowsRoot = 'C:\\Users\\Example'
    const windowsSystemHome = `${windowsRoot}\\.codex`
    const windowsAccountAHome = `${windowsRoot}\\AppData\\Roaming\\Orca\\codex-accounts\\a\\home`
    const windowsAccountBHome = `${windowsRoot}\\AppData\\Roaming\\Orca\\codex-accounts\\b\\home`
    const windowsRolloutIn = (homePath: string): string =>
      `${join(homePath, 'sessions')}\\2026\\07\\20\\rollout-2026-07-20T15-50-19-${sessionId}.jsonl`
    const listSessionFiles = async function* (sessionsRoot: string): AsyncIterable<string> {
      yield `${sessionsRoot}\\2026\\07\\20\\rollout-2026-07-20T15-50-19-${sessionId}.jsonl`
    }

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: [windowsSystemHome, windowsAccountAHome, windowsAccountBHome],
        // Why: settings and discovery can disagree on drive/segment case; the selection must still match.
        getSelectedAccountCodexHome: () => windowsAccountBHome.toLowerCase(),
        systemCodexHomePath: windowsSystemHome,
        listSessionFiles
      })
    ).resolves.toEqual({
      homePath: windowsAccountBHome,
      transcriptPath: windowsRolloutIn(windowsAccountBHome)
    })
  })

  it('still resumes the only home holding the id, selected or not', async () => {
    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: [systemHome, sharedMirror, accountAHome, accountBHome],
        getSelectedAccountCodexHome: () => accountAHome,
        systemCodexHomePath: systemHome,
        listSessionFiles: listRolloutIn(accountBHome)
      })
    ).resolves.toEqual({ homePath: accountBHome, transcriptPath: rolloutIn(accountBHome) })
  })

  it('does not rescan into the selected account home when transcript provenance was rejected', async () => {
    const listSessionFiles = vi.fn((): AsyncIterable<string> => {
      throw new Error('must not scan')
    })

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: rolloutIn(accountBHome),
        trustedCodexHomes: [systemHome, accountAHome, accountBHome],
        getSelectedAccountCodexHome: () => accountAHome,
        systemCodexHomePath: systemHome,
        fileIsRegular: () => false,
        listSessionFiles
      })
    ).resolves.toBeNull()
    expect(listSessionFiles).not.toHaveBeenCalled()
  })
})

describe('claimsCodexRolloutLayout', () => {
  it('is true for a rollout path even if the file is missing', () => {
    expect(
      claimsCodexRolloutLayout('/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl')
    ).toBe(true)
  })

  it('is true for compressed rollouts and Windows-separated paths', () => {
    expect(
      claimsCodexRolloutLayout(
        '/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl.zst'
      )
    ).toBe(true)
    expect(
      claimsCodexRolloutLayout(
        'C:\\Users\\example\\.codex\\sessions\\2026\\07\\20\\rollout-session.jsonl'
      )
    ).toBe(true)
  })

  it('is true for a rollout under a home Orca no longer trusts, so resume cannot silently fall through to the selected account', () => {
    expect(
      claimsCodexRolloutLayout('/removed/account/home/sessions/2026/07/20/rollout-a.jsonl')
    ).toBe(true)
  })

  it('is false for Claude (or other non-Codex) transcript paths', () => {
    expect(
      claimsCodexRolloutLayout(
        '/Users/example/.claude/projects/-Users-example-repo/019f81b9-19a9-7651-a8d1-352d9420bd11.jsonl'
      )
    ).toBe(false)
  })

  it('is false for empty provenance and JSONL misplaced inside a sessions root', () => {
    expect(claimsCodexRolloutLayout(undefined)).toBe(false)
    expect(claimsCodexRolloutLayout('   ')).toBe(false)
    expect(claimsCodexRolloutLayout('/Users/example/.codex/sessions/rollout-a.jsonl')).toBe(false)
    expect(
      claimsCodexRolloutLayout('/Users/example/.codex/sessions/2026/07/20/nested/rollout-a.jsonl')
    ).toBe(false)
  })
})
