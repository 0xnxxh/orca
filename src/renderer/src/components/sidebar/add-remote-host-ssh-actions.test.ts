import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), toastMocks)
}))

import {
  loadSshConfigHostsForPicker,
  prefillFormFromSshConfigHost,
  saveNewSshHostFromForm
} from './add-remote-host-ssh-actions'

describe('individual SSH config host selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves effective values while leaving all config identities authoritative', async () => {
    let savedTarget: Omit<SshTarget, 'id'> | undefined
    const ssh = {
      resolveConfigHost: vi.fn().mockResolvedValue({
        alias: 'prod',
        hostname: 'prod.internal',
        port: 2222,
        username: 'deploy',
        identityFiles: ['/keys/first', '/keys/second'],
        identitiesOnly: true,
        forwardAgent: false,
        gssapiAuthentication: true,
        proxyUseFdpass: false
      }),
      listTargets: vi
        .fn()
        .mockImplementation(async () =>
          savedTarget ? [{ ...savedTarget, id: 'ssh-prod', source: 'manual' as const }] : []
        ),
      addTarget: vi.fn().mockImplementation(async ({ target }) => {
        savedTarget = target
        return { target: { ...target, id: 'ssh-prod', source: 'manual' }, repoReadoptions: [] }
      }),
      listConfigHosts: vi.fn(),
      importConfig: vi.fn()
    }
    const selection = await prefillFormFromSshConfigHost(
      {
        alias: 'prod',
        hostname: '%h.internal',
        port: 22,
        username: '',
        identityFile: '/keys/second',
        alreadyInOrca: false
      },
      ssh
    )

    expect(selection).not.toBeNull()
    const outcome = await saveNewSshHostFromForm({
      form: selection!.form,
      ssh,
      recordSshRepoReadoptions: vi.fn(),
      setSshTargetsMetadata: vi.fn(),
      recordFeatureInteraction: vi.fn()
    })

    expect(outcome).toBe('saved')
    expect(ssh.resolveConfigHost).toHaveBeenCalledWith({ alias: 'prod' })
    expect(savedTarget).toMatchObject({
      label: 'prod',
      configHost: 'prod',
      host: 'prod.internal',
      port: 2222,
      username: 'deploy',
      gssapiAuthentication: true
    })
    expect(savedTarget).not.toHaveProperty('identityFile')
    expect(savedTarget).not.toHaveProperty('source')
  })
})

describe('SSH config picker response admission', () => {
  it('accepts the legacy preload array without exposing an unbounded row list', async () => {
    const hosts = Array.from({ length: 150 }, (_, index) => ({
      alias: `host-${index}`,
      hostname: `host-${index}`,
      port: 22,
      username: '',
      alreadyInOrca: index === 0
    }))
    const result = await loadSshConfigHostsForPicker({
      listConfigHosts: vi.fn().mockResolvedValue(hosts)
    } as never)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toMatchObject({
        totalHostCount: 150,
        newHostCount: 149,
        matchCount: 150,
        hasMore: true
      })
      expect(result.result.hosts).toHaveLength(100)
    }
  })

  it('explains when a live renderer still has the older preload API', async () => {
    await expect(
      prefillFormFromSshConfigHost(
        {
          alias: 'prod',
          hostname: 'prod',
          port: 22,
          username: '',
          alreadyInOrca: false
        },
        {} as never
      )
    ).rejects.toThrow('Restart Orca')
  })
})
