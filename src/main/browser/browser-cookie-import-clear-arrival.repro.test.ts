import { describe, expect, it, vi } from 'vitest'
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

// Why (STA-4170): a stateful jar is required so the mid-clear arrival is a real extra
// cookie on the second get, not a one-shot mockResolvedValueOnce swap.
function createArrivalJarSession(
  initial: Cookie[],
  options: {
    failOn?: string
    arrival?: Cookie
  } = {}
) {
  const arrival = options.arrival ?? cookie('.arrival.test', 'arrived-during-clear')
  let jar = [...initial]
  let injectedArrival = false

  const get = vi.fn(async () => [...jar])
  const remove = vi.fn(async (_url: string, name: string) => {
    if (name === options.failOn) {
      throw new Error('cookie store unavailable')
    }
    jar = jar.filter((entry) => entry.name !== name)
  })
  const clearData = vi.fn(async () => {
    if (!injectedArrival) {
      jar.push(arrival)
      injectedArrival = true
    }
    throw new Error('storage busy')
  })
  const snapshotClearIdentities = vi.fn(
    async (items: Parameters<typeof identitiesFromClearCookies>[0]) =>
      identitiesFromClearCookies(items)
  )
  const restoreClearIdentities = vi.fn(async (identities: readonly CookieClearIdentity[]) => {
    for (const identity of identities) {
      if (jar.some((entry) => entry.name === identity.name)) {
        continue
      }
      jar.push(cookie(identity.domain ?? '', identity.name, identity.path, identity.secure))
    }
  })

  const session: CookieClearSession & { names: () => string[] } = {
    cookies: { get, remove },
    clearData,
    snapshotClearIdentities,
    restoreClearIdentities,
    names: () => jar.map((entry) => entry.name).sort()
  }

  return {
    session,
    get,
    remove,
    clearData,
    snapshotClearIdentities,
    restoreClearIdentities,
    arrival
  }
}

function restoredNames(restoreClearIdentities: { mock: { calls: unknown[][] } }): string[] {
  const identities = restoreClearIdentities.mock.calls[0]?.[0]
  if (!Array.isArray(identities)) {
    return []
  }
  return identities.map((identity: { name: string }) => identity.name)
}

describe('STA-4170 arrival during rejected bulk cookie clear', () => {
  it('does not silently delete a cookie that arrives during a rejected bulk clear', async () => {
    const { session, get, remove, clearData, restoreClearIdentities } = createArrivalJarSession([
      cookie('.example.com', 'existing')
    ])

    await expect(removeTransplantableCookies(session)).resolves.toBeUndefined()

    expect(get).toHaveBeenCalledTimes(2)
    expect(clearData).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls).toEqual([['https://example.com/', 'existing']])
    expect(restoreClearIdentities).not.toHaveBeenCalled()
    expect(session.names()).toEqual(['arrived-during-clear'])
  })

  it('does not claim restoration after deleting a cookie that arrived during a rejected bulk clear', async () => {
    const { session, get, remove, clearData, restoreClearIdentities } = createArrivalJarSession(
      [cookie('.example.com', 'existing'), cookie('.other.test', 'stale')],
      { failOn: 'stale' }
    )

    await expect(removeTransplantableCookies(session)).rejects.toThrow(
      /existing cookies were restored/
    )

    expect(get).toHaveBeenCalledTimes(2)
    expect(clearData).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls).toEqual([
      ['https://example.com/', 'existing'],
      ['https://other.test/', 'stale']
    ])
    expect(restoreClearIdentities).toHaveBeenCalledTimes(1)
    expect(restoredNames(restoreClearIdentities)).not.toContain('arrived-during-clear')
    expect(session.names()).toEqual(['arrived-during-clear', 'existing', 'stale'])
  })
})
