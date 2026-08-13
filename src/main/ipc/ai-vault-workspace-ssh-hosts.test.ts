import { describe, expect, it } from 'vitest'
import type { SshConnectionStatus, SshTarget } from '../../shared/ssh-types'
import { listWorkspaceSshAiVaultHosts } from './ai-vault-workspace-ssh-hosts'

const target = (id: string, overrides: Partial<SshTarget> = {}): SshTarget => ({
  id,
  label: id,
  host: `${id}.example`,
  port: 22,
  username: 'ada',
  ...overrides
})

function listHosts(args: {
  repos: readonly { connectionId?: string | null; kind?: 'git' | 'folder' }[]
  targets: readonly SshTarget[]
  statuses?: Record<string, SshConnectionStatus>
}) {
  return listWorkspaceSshAiVaultHosts({
    getRepos: () => args.repos,
    listTargets: () => args.targets,
    getConnectionStatus: (targetId) => args.statuses?.[targetId]
  })
}

describe('listWorkspaceSshAiVaultHosts', () => {
  it('ignores registered targets that own no workspace', () => {
    expect(
      listHosts({
        repos: [{ connectionId: 'dev-box' }],
        targets: [target('dev-box'), target('imported-alias')]
      })
    ).toEqual([{ targetId: 'dev-box', label: 'dev-box', connectionStatus: undefined }])
  })

  it('drops repos pointing at a removed target', () => {
    expect(listHosts({ repos: [{ connectionId: 'gone' }], targets: [] })).toEqual([])
  })

  it('excludes runtime-owned targets', () => {
    expect(
      listHosts({
        repos: [{ connectionId: 'runtime-ssh-vm-1' }, { connectionId: 'owned' }],
        targets: [
          target('runtime-ssh-vm-1'),
          target('owned', { owner: { type: 'on-demand-runtime', runtimeId: 'vm-2' } })
        ]
      })
    ).toEqual([])
  })

  it('dedupes a host that owns both a git repo and a folder workspace', () => {
    expect(
      listHosts({
        repos: [
          { connectionId: 'dev-box', kind: 'git' },
          { connectionId: 'dev-box', kind: 'folder' }
        ],
        targets: [target('dev-box', { label: '  Dev Box  ' })],
        statuses: { 'dev-box': 'disconnected' }
      })
    ).toEqual([{ targetId: 'dev-box', label: 'Dev Box', connectionStatus: 'disconnected' }])
  })

  it('passes the live connection status through', () => {
    expect(
      listHosts({
        repos: [{ connectionId: 'dev-box' }, { connectionId: 'gpu-1' }],
        targets: [target('dev-box'), target('gpu-1')],
        statuses: { 'dev-box': 'connecting' }
      })
    ).toEqual([
      { targetId: 'dev-box', label: 'dev-box', connectionStatus: 'connecting' },
      { targetId: 'gpu-1', label: 'gpu-1', connectionStatus: undefined }
    ])
  })
})
