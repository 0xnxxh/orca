import { describe, expect, it } from 'vitest'
import type { Cookie } from 'electron'
import {
  identitiesFromClearCookies,
  removeTransplantableCookies,
  type CookieClearIdentity,
  type CookieClearSession
} from './browser-cookie-import-clear'

function cookie(domain: string, name: string, path = '/', secure = true): Cookie {
  return {
    domain,
    name,
    path,
    secure,
    sameSite: 'unspecified',
    value: `${name}-value`
  }
}

function createJarSession(
  initial: Cookie[],
  options: {
    failOn?: string
    restoreError?: Error
    snapshot?: CookieClearSession['snapshotClearIdentities']
  } = {}
) {
  let jar = [...initial]
  const removedNames: string[] = []
  const session: CookieClearSession & {
    names: () => string[]
    removedNames: () => string[]
  } = {
    cookies: {
      get: async () => [...jar],
      remove: async (_url, name) => {
        if (name === (options.failOn ?? 'stale')) {
          throw new Error('cookie store unavailable')
        }
        removedNames.push(name)
        jar = jar.filter((entry) => entry.name !== name)
      }
    },
    clearData: async () => {
      throw new Error('storage busy')
    },
    snapshotClearIdentities:
      options.snapshot ?? (async (items) => identitiesFromClearCookies(items)),
    restoreClearIdentities: async (identities) => {
      if (options.restoreError) {
        throw options.restoreError
      }
      for (const identity of identities) {
        if (jar.some((entry) => entry.name === identity.name)) {
          continue
        }
        jar.push(cookie(identity.domain ?? '', identity.name, identity.path, identity.secure))
      }
    },
    names: () => jar.map((entry) => entry.name).sort(),
    removedNames: () => [...removedNames]
  }
  return session
}

describe('STA-4090 failed full cookie clear', () => {
  it('does not permanently delete a cookie removed before another removal rejects', async () => {
    const session = createJarSession([
      cookie('.google.com', 'SID'),
      cookie('.example.com', 'removed-first', '/one'),
      cookie('.other.test', 'stale', '/two')
    ])

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /existing cookies were restored/
    )

    expect(session.removedNames()).toEqual(['removed-first'])
    expect(session.names()).toEqual(['SID', 'removed-first', 'stale'])
  })

  it('does not start removing when a cookie identity cannot be snapshotted', async () => {
    const session = createJarSession(
      [cookie('.example.com', 'removed-first'), cookie('.other.test', 'stale')],
      {
        snapshot: async (items) =>
          identitiesFromClearCookies(items.filter(({ cookie: entry }) => entry.name !== 'stale'))
      }
    )

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /the session was left unchanged/
    )
    expect(session.removedNames()).toEqual([])
    expect(session.names()).toEqual(['removed-first', 'stale'])
  })

  it('reports a partial clear only when restore also fails', async () => {
    const session = createJarSession(
      [cookie('.example.com', 'removed-first'), cookie('.other.test', 'stale')],
      { restoreError: new Error('restore rejected') }
    )

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /the session was left partially cleared/
    )
    expect(session.names()).toEqual(['stale'])
  })

  it('restores a partitioned identity through the captured restore channel', async () => {
    const identities: CookieClearIdentity[] = []
    const session: CookieClearSession = {
      cookies: {
        get: async () => [cookie('.example.com', 'removed-first'), cookie('.other.test', 'stale')],
        remove: async (_url, name) => {
          if (name === 'stale') {
            throw new Error('cookie store unavailable')
          }
        }
      },
      clearData: async () => {
        throw new Error('storage busy')
      },
      snapshotClearIdentities: async (items) =>
        identitiesFromClearCookies(items).map((identity) =>
          identity.name === 'removed-first'
            ? {
                ...identity,
                partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
              }
            : identity
        ),
      restoreClearIdentities: async (restored) => {
        identities.push(...restored)
      }
    }

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /existing cookies were restored/
    )
    expect(identities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'removed-first',
          partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
        }),
        expect.objectContaining({ name: 'stale' })
      ])
    )
  })

  // Why (STA-4170): fallback re-reads the live jar, so a login cookie that arrives after
  // the pre-clear snapshot can be deleted. Rollback must restore that arrival too.
  it('restores a post-snapshot arrival when a later fallback removal fails', async () => {
    let jar = [
      cookie('.example.com', 'pre-existing', '/one'),
      cookie('.other.test', 'later-fail', '/two')
    ]
    const removedNames: string[] = []
    const restoredNames: string[] = []
    const session: CookieClearSession & { names: () => string[] } = {
      cookies: {
        get: async () => [...jar],
        remove: async (_url, name) => {
          if (name === 'later-fail') {
            throw new Error('cookie store unavailable')
          }
          removedNames.push(name)
          jar = jar.filter((entry) => entry.name !== name)
        }
      },
      clearData: async () => {
        jar = [
          cookie('.login.test', 'arrived-during-clear'),
          cookie('.other.test', 'later-fail', '/two')
        ]
        throw new Error('storage busy')
      },
      snapshotClearIdentities: async (items) => identitiesFromClearCookies(items),
      restoreClearIdentities: async (identities) => {
        restoredNames.push(...identities.map((identity) => identity.name))
        for (const identity of identities) {
          if (jar.some((entry) => entry.name === identity.name)) {
            continue
          }
          jar.push(cookie(identity.domain ?? '', identity.name, identity.path, identity.secure))
        }
      },
      names: () => jar.map((entry) => entry.name).sort()
    }

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /existing cookies were restored/
    )

    expect(removedNames).toEqual(['arrived-during-clear'])
    expect(restoredNames).toEqual(expect.arrayContaining(['arrived-during-clear', 'pre-existing']))
    expect(session.names()).toEqual(['arrived-during-clear', 'later-fail', 'pre-existing'])
  })

  it('restores the pre-clear snapshot when leftover identity capture fails', async () => {
    let jar = [
      cookie('.example.com', 'pre-existing', '/one'),
      cookie('.other.test', 'leftover', '/two')
    ]
    let snapshotCalls = 0
    const removedNames: string[] = []
    const session: CookieClearSession & { names: () => string[] } = {
      cookies: {
        get: async () => [...jar],
        remove: async (_url, name) => {
          removedNames.push(name)
          jar = jar.filter((entry) => entry.name !== name)
        }
      },
      clearData: async () => {
        jar = [cookie('.other.test', 'leftover', '/two')]
        throw new Error('storage busy')
      },
      snapshotClearIdentities: async (items) => {
        snapshotCalls += 1
        if (snapshotCalls > 1) {
          throw new Error('could not snapshot leftover cookies')
        }
        return identitiesFromClearCookies(items)
      },
      restoreClearIdentities: async (identities) => {
        for (const identity of identities) {
          if (jar.some((entry) => entry.name === identity.name)) {
            continue
          }
          jar.push(cookie(identity.domain ?? '', identity.name, identity.path, identity.secure))
        }
      },
      names: () => jar.map((entry) => entry.name).sort()
    }

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /existing cookies were restored/
    )
    expect(removedNames).toEqual([])
    expect(session.names()).toEqual(['leftover', 'pre-existing'])
  })

  it('does not remove cookies that arrive after the leftover set is fenced', async () => {
    let jar = [cookie('.example.com', 'survived'), cookie('.other.test', 'tracker')]
    const removedNames: string[] = []
    const session: CookieClearSession & { names: () => string[] } = {
      cookies: {
        get: async () => [...jar],
        remove: async (_url, name) => {
          removedNames.push(name)
          jar = jar.filter((entry) => entry.name !== name)
          if (name === 'survived') {
            jar.push(cookie('.late.test', 'late-arrival'))
          }
        }
      },
      clearData: async () => {
        throw new Error('storage busy')
      },
      snapshotClearIdentities: async (items) => identitiesFromClearCookies(items),
      restoreClearIdentities: async () => undefined,
      names: () => jar.map((entry) => entry.name).sort()
    }

    await removeTransplantableCookies(session)

    expect(removedNames).toHaveLength(2)
    expect(removedNames).toEqual(expect.arrayContaining(['survived', 'tracker']))
    expect(removedNames).not.toContain('late-arrival')
    expect(session.names()).toEqual(['late-arrival'])
  })

  it('serializes concurrent clears on the same session', async () => {
    const activeClears: number[] = []
    let inClear = 0
    const session: CookieClearSession = {
      cookies: {
        get: async () => [cookie('.example.com', 'session')],
        remove: async () => {
          inClear += 1
          activeClears.push(inClear)
          await Promise.resolve()
          inClear -= 1
        }
      },
      clearData: async () => {
        throw new Error('storage busy')
      },
      snapshotClearIdentities: async (items) => identitiesFromClearCookies(items),
      restoreClearIdentities: async () => undefined
    }

    await Promise.all([removeTransplantableCookies(session), removeTransplantableCookies(session)])

    expect(activeClears).toEqual([1, 1])
  })
})
