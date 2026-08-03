import { describe, expect, it, vi } from 'vitest'
import {
  SSH_CONFIG_HOST_RESULT_LIMIT,
  resolveUserSshConfigHost,
  searchSshConfigHosts
} from './ssh-config-host-picker'
import type { SshResolvedConfig } from './ssh-g-config-resolution'

function resolved(overrides: Partial<SshResolvedConfig> = {}): SshResolvedConfig {
  return {
    hostname: 'prod.internal',
    user: 'deploy',
    port: 2222,
    identityFile: ['/keys/first', '/keys/second'],
    identitiesOnly: true,
    forwardAgent: false,
    gssapiAuthentication: true,
    proxyUseFdpass: false,
    controlMaster: 'no',
    controlPersist: 'no',
    ...overrides
  }
}

describe('SSH config host picker search', () => {
  it('bounds results while searching aliases beyond the first page', () => {
    const hosts = Array.from({ length: 150_000 }, (_, index) => ({
      host: `generated-${index}`
    }))
    const initial = searchSshConfigHosts(hosts, [])
    const last = searchSshConfigHosts(hosts, [], 'generated-149999')

    expect(initial.hosts).toHaveLength(SSH_CONFIG_HOST_RESULT_LIMIT)
    expect(initial).toMatchObject({
      totalHostCount: 150_000,
      newHostCount: 150_000,
      matchCount: 150_000,
      hasMore: true
    })
    expect(last.hosts.map((host) => host.alias)).toEqual(['generated-149999'])
    expect(last.hasMore).toBe(false)
  })

  it('counts de-duplicated and existing aliases while matching effective display fields', () => {
    const result = searchSshConfigHosts(
      [
        { host: 'prod', hostname: 'prod.internal', user: 'deploy' },
        { host: 'prod', hostname: 'ignored.internal' },
        { host: 'stage', hostname: 'stage.internal', user: 'ops' }
      ],
      [{ configHost: 'prod', label: 'Production' }],
      'internal'
    )

    expect(result).toMatchObject({
      totalHostCount: 2,
      newHostCount: 1,
      matchCount: 2,
      hasMore: false
    })
    expect(result.hosts[0]).toMatchObject({ alias: 'prod', alreadyInOrca: true })
  })

  it('omits suppressed aliases from results and counts', () => {
    const result = searchSshConfigHosts([{ host: 'removed' }, { host: 'active' }], [], '', [
      'removed'
    ])

    expect(result).toMatchObject({ totalHostCount: 1, newHostCount: 1, matchCount: 1 })
    expect(result.hosts.map((host) => host.alias)).toEqual(['active'])
  })
})

describe('resolveUserSshConfigHost', () => {
  it('returns effective endpoint and the complete authentication contract', async () => {
    const resolver = vi.fn().mockResolvedValue(resolved())

    await expect(resolveUserSshConfigHost('prod', resolver)).resolves.toEqual({
      alias: 'prod',
      hostname: 'prod.internal',
      username: 'deploy',
      port: 2222,
      identityFiles: ['/keys/first', '/keys/second'],
      identitiesOnly: true,
      forwardAgent: false,
      gssapiAuthentication: true,
      proxyUseFdpass: false
    })
    expect(resolver).toHaveBeenCalledWith('prod')
  })

  it('returns null when OpenSSH cannot resolve an endpoint', async () => {
    await expect(resolveUserSshConfigHost('missing', async () => null)).resolves.toBeNull()
  })
})
