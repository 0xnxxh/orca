import { afterEach, describe, expect, it, vi } from 'vitest'

describe('readGrokAuthSession', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('node:fs')
    vi.doUnmock('node:fs/promises')
  })

  // A mount that answers neither stat nor read (EACCES/ELOOP/EIO) is "signed out", not a
  // failure — an 'error' here pins a status-bar alert on a user who never signed in.
  it('treats an unreachable auth path as signed out in both twins', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => {
        throw new Error('EIO: i/o error')
      })
    }))
    vi.doMock('node:fs/promises', () => ({
      access: vi.fn(() => Promise.reject(new Error('EIO: i/o error'))),
      readFile: vi.fn(() => Promise.reject(new Error('EIO: i/o error')))
    }))
    const { readGrokAuthSession, readGrokAuthSessionAsync } = await import('./grok-auth')

    expect(readGrokAuthSession()).toEqual({ status: 'missing' })
    await expect(readGrokAuthSessionAsync()).resolves.toEqual({ status: 'missing' })
  })

  it('redacts filesystem paths from auth read failures', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => {
        throw new Error(
          'EACCES: permission denied, open /Users/brennanbenson/private/.grok/auth.json'
        )
      })
    }))
    const { readGrokAuthSession } = await import('./grok-auth')

    expect(readGrokAuthSession()).toEqual({
      status: 'error',
      error: 'Unable to read Grok auth file'
    })
  })

  it('treats a token-less auth file as signed out, not an error', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => JSON.stringify({ 'https://auth.x.ai::client': { user_id: 'u1' } }))
    }))
    const { readGrokAuthSession } = await import('./grok-auth')

    expect(readGrokAuthSession()).toEqual({ status: 'missing' })
  })

  it('reports malformed auth JSON without parser details', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => '{')
    }))
    const { readGrokAuthSession } = await import('./grok-auth')

    expect(readGrokAuthSession()).toEqual({
      status: 'error',
      error: 'Grok auth file is invalid'
    })
  })

  it.each(['https://auth.x.ai', 'https://auth.x.ai::client'])(
    'prefers the %s issuer entry over an earlier alternate issuer',
    async (preferredIssuer) => {
      vi.doMock('node:fs', () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() =>
          JSON.stringify({
            'https://stale.example.com::client': {
              key: 'stale-token',
              user_id: 'stale-user',
              email: 'stale@example.com',
              expires_at: '2099-01-01T00:00:00.000Z'
            },
            [preferredIssuer]: {
              key: 'live-token',
              user_id: 'live-user',
              email: 'live@example.com',
              team_id: 'team-1',
              expires_at: '2099-06-01T00:00:00.000Z',
              oidc_client_id: 'client-1'
            }
          })
        )
      }))
      const { readGrokAuthSession } = await import('./grok-auth')

      expect(readGrokAuthSession()).toEqual({
        status: 'ok',
        session: {
          accessToken: 'live-token',
          userId: 'live-user',
          email: 'live@example.com',
          teamId: 'team-1',
          expiresAtMs: Date.parse('2099-06-01T00:00:00.000Z'),
          oidcClientId: 'client-1'
        }
      })
    }
  )

  it('falls back to the first tokenized entry when no auth.x.ai key exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          'https://alternate.example.com::client': {
            key: 'alt-token',
            user_id: 'alt-user',
            email: 'alt@example.com',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        })
      )
    }))
    const { readGrokAuthSession } = await import('./grok-auth')

    expect(readGrokAuthSession()).toEqual({
      status: 'ok',
      session: {
        accessToken: 'alt-token',
        userId: 'alt-user',
        email: 'alt@example.com',
        teamId: null,
        expiresAtMs: Date.parse('2099-01-01T00:00:00.000Z'),
        oidcClientId: null
      }
    })
  })

  it('skips an expired auth.x.ai client entry when a fresh one follows it', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          'https://auth.x.ai::old-client': {
            key: 'expired-token',
            expires_at: '2020-01-01T00:00:00.000Z'
          },
          'https://auth.x.ai::current-client': {
            key: 'fresh-token',
            expires_at: '2099-01-01T00:00:00.000Z'
          }
        })
      )
    }))
    const { readGrokAuthSession } = await import('./grok-auth')

    expect(readGrokAuthSession()).toMatchObject({
      status: 'ok',
      session: { accessToken: 'fresh-token' }
    })
  })

  it('does not resurrect an alternate issuer when an auth.x.ai entry is tokenless', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          'https://alternate.example.com::client': { key: 'stale-token' },
          'https://auth.x.ai::client': { user_id: 'signed-out-user' }
        })
      )
    }))
    const { readGrokAuthSession } = await import('./grok-auth')

    expect(readGrokAuthSession()).toEqual({ status: 'missing' })
  })
})

// Coverage moved from the deleted grok-accounts/status.ts, whose sync getGrokAccountStatus
// duplicated this mapper and lost its last production caller when the IPC handler went async.
describe('toGrokAccountStatus', () => {
  it('reports signed out without an error when auth is missing', async () => {
    const { toGrokAccountStatus } = await import('./grok-auth')

    expect(toGrokAccountStatus({ status: 'missing' })).toEqual({
      signedIn: false,
      email: null,
      teamId: null,
      tokenFresh: false,
      error: null
    })
  })

  it('surfaces auth read errors without exposing token fields', async () => {
    const { toGrokAccountStatus } = await import('./grok-auth')

    expect(toGrokAccountStatus({ status: 'error', error: 'Grok auth file is invalid' })).toEqual({
      signedIn: false,
      email: null,
      teamId: null,
      tokenFresh: false,
      error: 'Grok auth file is invalid'
    })
  })

  it('returns non-secret signed-in metadata and staleness', async () => {
    const { toGrokAccountStatus } = await import('./grok-auth')

    const status = toGrokAccountStatus({
      status: 'ok',
      session: {
        accessToken: 'secret-token',
        email: 'dev@example.com',
        teamId: 'team-1',
        userId: 'user-1',
        expiresAtMs: Date.now() - 1_000,
        oidcClientId: 'client-1'
      }
    })

    expect(status).toEqual({
      signedIn: true,
      email: 'dev@example.com',
      teamId: 'team-1',
      tokenFresh: false,
      error: null
    })
    expect(JSON.stringify(status)).not.toContain('secret-token')
    expect(JSON.stringify(status)).not.toContain('client-1')
  })
})
