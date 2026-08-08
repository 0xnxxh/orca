import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalAuthorityNamespaceLocator } from '../../shared/terminal-session-authority-locator'
import { acquireTerminalAuthorityWriterGuard } from './terminal-authority-writer-storage'
import { openTerminalAuthorityWriterWithRecovery } from './terminal-authority-writer-recovery'
import { terminalSessionAuthorityNamespaceDirectory } from './terminal-session-authority-namespace-directory'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('TerminalSessionAuthorityRegistry', () => {
  it('durably resolves host-canonical namespaces without eagerly opening services', async () => {
    const directory = freshDirectory()
    let namespaceId = 0
    let serviceOpens = 0
    const first = await openRegistry(directory, {
      createNamespaceId: () => `namespace-${++namespaceId}`,
      onNamespaceServiceOpen: () => serviceOpens++
    })
    const workspace = locator('/srv/repo')
    const resolved = await first.resolveNamespace(workspace)
    const floating = await first.resolveNamespace({ kind: 'floating' })
    expect(resolved).toMatchObject({ created: true, namespace: { namespaceId: 'namespace-1' } })
    expect(floating).toMatchObject({ created: true, namespace: { namespaceId: 'namespace-2' } })
    expect(serviceOpens).toBe(0)
    await first.openNamespace(resolved.namespace)
    expect(serviceOpens).toBe(1)
    await first.close()

    const reopened = await openRegistry(directory, {
      ownerToken: 'registry-owner-b',
      onNamespaceServiceOpen: () => serviceOpens++
    })
    expect(reopened.registeredNamespaces()).toHaveLength(2)
    expect(serviceOpens).toBe(1)
    const stable = await reopened.resolveNamespace(workspace)
    expect(stable).toEqual({ created: false, namespace: resolved.namespace })
    expect(serviceOpens).toBe(1)
    const service = await reopened.openNamespace(stable.namespace)
    expect(service.writerAccess.writerEpoch).toBe(2)
    expect(serviceOpens).toBe(2)
  })

  it('rejects unknown, cross-host, and corrupt duplicate namespace identities', async () => {
    const directory = freshDirectory()
    const registry = await openRegistry(directory, { createNamespaceId: () => 'namespace-a' })
    const resolved = await registry.resolveNamespace(locator('/srv/repo'))
    await expect(
      registry.openNamespace({
        authorityHostId: 'other-host',
        namespaceId: resolved.namespace.namespaceId
      })
    ).rejects.toMatchObject({ code: 'expectation-mismatch' })
    await expect(
      registry.openNamespace({ authorityHostId: 'host-a', namespaceId: 'unknown' })
    ).rejects.toMatchObject({ code: 'expectation-mismatch' })
    await registry.close()

    const indexPath = path.join(directory, 'terminal-authority-namespaces.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    index.entries.push({ ...index.entries[0] })
    writeFileSync(indexPath, `${JSON.stringify(index)}\n`)
    await expect(openRegistry(directory, { ownerToken: 'registry-owner-b' })).rejects.toMatchObject(
      { code: 'record-corrupt' }
    )
  })

  it('fences a concurrent registry writer before it can resolve a namespace', async () => {
    const directory = freshDirectory()
    await openRegistry(directory)
    await expect(openRegistry(directory, { ownerToken: 'registry-owner-b' })).rejects.toMatchObject(
      { code: 'writer-fenced' }
    )
  })

  it('recovers a lazy namespace still owned by an older root predecessor', async () => {
    const directory = freshDirectory()
    const first = await openRegistry(directory)
    const resolved = await first.resolveNamespace(locator('/srv/repo'))
    await first.openNamespace(resolved.namespace)
    await openRegistry(directory, {
      ownerToken: 'registry-owner-b',
      ownerIncarnationId: 'owner-incarnation-b',
      takeoverOwnerToken: 'registry-owner-a'
    })
    const deadOwners = new Set(['registry-owner-a', 'registry-owner-b'])
    const finalRegistry = await openRegistry(directory, {
      ownerToken: 'registry-owner-c',
      ownerIncarnationId: 'owner-incarnation-c',
      takeoverOwnerToken: 'registry-owner-b',
      writerClaimIsGone: async (ownerToken) => deadOwners.has(ownerToken)
    })

    const service = await finalRegistry.openNamespace(resolved.namespace)
    expect(service.writerAccess.writerEpoch).toBe(2)
  })

  it.each([
    { gone: ['registry-owner-a'], succeeds: false },
    { gone: ['registry-owner-b'], succeeds: false },
    { gone: ['registry-owner-a', 'registry-owner-b'], succeeds: true }
  ])(
    'requires proof for every lazy namespace marker/guard claimant: $gone',
    async ({ gone, succeeds }) => {
      const directory = freshDirectory()
      const first = await openRegistry(directory)
      const resolved = await first.resolveNamespace(locator('/srv/repo'))
      await first.openNamespace(resolved.namespace)
      await openRegistry(directory, {
        ownerToken: 'registry-owner-b',
        ownerIncarnationId: 'owner-incarnation-b',
        takeoverOwnerToken: 'registry-owner-a'
      })
      const namespaceDirectory = terminalSessionAuthorityNamespaceDirectory(
        directory,
        resolved.namespace
      )
      await acquireTerminalAuthorityWriterGuard(namespaceDirectory, 'registry-owner-b')
      const claimIsGone = async (ownerToken: string): Promise<boolean> => gone.includes(ownerToken)
      const finalRegistryOpening = openTerminalAuthorityWriterWithRecovery({
        directory,
        claimIsGone,
        open: (takeoverOwnerToken) =>
          openRegistry(directory, {
            ownerToken: 'registry-owner-c',
            ownerIncarnationId: 'owner-incarnation-c',
            writerClaimIsGone: claimIsGone,
            ...(takeoverOwnerToken ? { takeoverOwnerToken } : {})
          })
      })
      if (!gone.includes('registry-owner-b')) {
        await expect(finalRegistryOpening).rejects.toMatchObject({ code: 'writer-fenced' })
        return
      }
      const finalRegistry = await finalRegistryOpening
      const opening = finalRegistry.openNamespace(resolved.namespace)
      const expectation = succeeds ? expect(opening).resolves : expect(opening).rejects
      await expectation.toMatchObject(
        succeeds ? { writerAccess: { writerEpoch: 2 } } : { code: 'writer-fenced' }
      )
    }
  )
})

async function openRegistry(
  directory: string,
  overrides: Partial<Parameters<typeof TerminalSessionAuthorityRegistry.open>[0]> = {}
): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory,
    authorityHostId: 'host-a',
    ownerToken: 'registry-owner-a',
    ownerIncarnationId: 'owner-incarnation-a',
    writerActorId: 'writer-a',
    ...overrides
  })
  registries.push(registry)
  return registry
}

function locator(canonicalPath: string): TerminalAuthorityNamespaceLocator {
  return { kind: 'workspace', canonicalPath, pathFlavor: 'posix' }
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-authority-registry-'))
  directories.push(directory)
  return directory
}
