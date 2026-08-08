import { describe, expect, it } from 'vitest'
import type { TerminalAuthorityPathFlavor } from '../../shared/terminal-session-authority-locator'
import type {
  SshLegacyWorkspaceReference,
  SshLegacyWorkspaceResolution
} from './ssh-legacy-migration-evidence-bridge-types'
import { createSshLegacyHostLocatorResolver } from './ssh-legacy-migration-host-locator'

const HOST = 'authority-host-a'

function resolve(
  reference: SshLegacyWorkspaceReference,
  options: Readonly<{
    flavor?: TerminalAuthorityPathFlavor
    references?: readonly SshLegacyWorkspaceReference[]
  }> = {}
): SshLegacyWorkspaceResolution {
  const resolver = createSshLegacyHostLocatorResolver({
    authorityHostId: HOST,
    hostPathFlavor: options.flavor ?? 'posix',
    references: options.references ?? []
  })
  return resolver({
    targetId: 'target-a',
    authorityHostId: HOST,
    hostPathFlavor: options.flavor ?? 'posix',
    source: 'local-layout',
    partitionId: null,
    endpointId: null,
    reference
  }) as SshLegacyWorkspaceResolution
}

const GIT: SshLegacyWorkspaceReference = Object.freeze({
  kind: 'git-worktree',
  clientWorkspaceId: 'repo-a::worktree-a',
  path: '/srv/repos/repo-a'
})

describe('final host locator', () => {
  it('names a git worktree namespace from the host path and keeps the legacy worktree id', () => {
    const resolved = resolve(GIT)
    expect(resolved.workspace).toEqual({
      kind: 'git-worktree',
      locator: { kind: 'workspace', canonicalPath: '/srv/repos/repo-a', pathFlavor: 'posix' },
      worktreeId: 'repo-a::worktree-a'
    })
    expect(resolved.namespace.authorityHostId).toBe(HOST)
  })

  it('names a folder workspace and a floating workspace by their own locator kinds', () => {
    expect(
      resolve({
        kind: 'folder-workspace',
        clientWorkspaceId: 'folder:folder-a',
        path: '/srv/folders/a'
      }).workspace.kind
    ).toBe('folder')
    expect(
      resolve({ kind: 'floating', clientWorkspaceId: 'floating', path: '/tmp' }).workspace
    ).toEqual({ kind: 'floating', locator: { kind: 'floating' } })
  })

  it('gives every floating pane on a host one namespace regardless of its path', () => {
    const first = resolve({ kind: 'floating', clientWorkspaceId: 'floating', path: '/tmp/a' })
    const second = resolve({ kind: 'floating', clientWorkspaceId: 'floating', path: null })
    expect(first.namespace.namespaceId).toBe(second.namespace.namespaceId)
  })

  it('separates namespaces by host path and not by the client workspace id', () => {
    const sameHostPath = resolve({ ...GIT, clientWorkspaceId: 'repo-b::worktree-b' })
    const otherHostPath = resolve({ ...GIT, path: '/srv/repos/repo-b' })
    expect(sameHostPath.namespace.namespaceId).toBe(resolve(GIT).namespace.namespaceId)
    expect(otherHostPath.namespace.namespaceId).not.toBe(resolve(GIT).namespace.namespaceId)
  })

  it('canonicalises equivalent POSIX spellings onto one namespace', () => {
    expect(resolve({ ...GIT, path: '/srv/repos/./repo-a/' }).namespace.namespaceId).toBe(
      resolve(GIT).namespace.namespaceId
    )
  })

  it.each([
    ['C:\\Users\\u\\repo', 'C:/Users/u/repo'],
    ['c:/Users/u/repo/', 'C:/Users/u/repo'],
    ['//server/share/repo', '//server/share/repo']
  ])('canonicalises the Windows path %s', (raw, expected) => {
    const resolved = resolve({ ...GIT, path: raw }, { flavor: 'windows' })
    expect(resolved.workspace).toMatchObject({
      locator: { canonicalPath: expected, pathFlavor: 'windows' }
    })
  })

  it('resolves a remote snapshot host path back to the workspace that owns it', () => {
    const resolved = resolve(
      { kind: 'workspace-path', path: '/srv/repos/repo-a' },
      {
        references: [GIT]
      }
    )
    expect(resolved.workspace).toMatchObject({
      kind: 'git-worktree',
      worktreeId: 'repo-a::worktree-a'
    })
  })

  it('treats an unknown remote snapshot path as its own host workspace', () => {
    const resolved = resolve(
      { kind: 'workspace-path', path: '/srv/repos/other' },
      {
        references: [GIT]
      }
    )
    expect(resolved.workspace.kind).toBe('folder')
  })

  it('refuses to name a host path claimed by two client workspaces', () => {
    expect(() =>
      resolve(GIT, { references: [GIT, { ...GIT, clientWorkspaceId: 'repo-b::worktree-b' }] })
    ).toThrow(/ambiguous/u)
  })

  it('rejects a resolution requested for a different authority host', () => {
    const resolver = createSshLegacyHostLocatorResolver({
      authorityHostId: HOST,
      hostPathFlavor: 'posix',
      references: []
    })
    expect(() =>
      resolver({
        targetId: 'target-a',
        authorityHostId: 'authority-host-b',
        hostPathFlavor: 'posix',
        source: 'relay-inventory',
        partitionId: null,
        endpointId: 'endpoint-a',
        reference: GIT
      })
    ).toThrow()
  })

  it.each(['relative/path', ''])('rejects the unusable host path %s', (path) => {
    expect(() => resolve({ ...GIT, path })).toThrow()
  })
})
