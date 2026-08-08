import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  TerminalLegacyMigrationImportRequest,
  TerminalLegacyUnresolvedCandidate
} from '../../shared/terminal-legacy-cutover'
import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalSessionAuthorityLogRecord } from '../../shared/terminal-session-authority-mutation'
import { terminalAuthorityOperationIdentity } from '../../shared/terminal-session-authority-operation-identity'
import {
  legacyAcknowledgementRequest,
  legacyCutoverRequest,
  legacyRecoveryOnlyRequest
} from './__tests__/terminal-legacy-cutover'
import { terminalSessionAuthorityNamespaceDirectory } from './terminal-session-authority-namespace-directory'
import {
  TERMINAL_AUTHORITY_CHECKPOINT_FILE,
  TERMINAL_AUTHORITY_LOG_FILE
} from './terminal-session-authority-record-files'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'

const directories: string[] = []
const registries: TerminalSessionAuthorityRegistry[] = []

afterEach(async () => {
  await Promise.allSettled(registries.splice(0).map((registry) => registry.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('namespace authority legacy migrations', () => {
  it('replays a synced self-contained event and rejects changed operation reuse', async () => {
    const directory = freshDirectory()
    let armed = false
    const registry = await openRegistry(directory, {
      onAuthorityCrashBoundary: (boundary, detail) => {
        if (armed && boundary === 'record-synced' && detail.eventKind === 'legacy-migration') {
          throw new Error('simulated authority response loss')
        }
      }
    })
    const namespace = await resolveNamespace(registry, 1)
    const request = legacyRecoveryOnlyRequest({ migrationNumber: 1, namespace })
    armed = true

    await expect(registry.legacy.importMigration(request)).rejects.toThrow(
      'simulated authority response loss'
    )
    const record = readAuthorityLog(directory, namespace)[0]!
    expect(record.event).toMatchObject({
      kind: 'legacy-migration',
      migration: {
        requestDigest: expect.any(String),
        receipt: {
          request: { mode: 'recovery-only', workerEvidence: { workerId: 'worker-1' } },
          recoveries: [{ recoveryId: 'recovery-1', status: 'unresolved' }]
        }
      }
    })
    expect(JSON.stringify(record)).not.toContain('catalog-import-ref')
    expect(existsSync(path.join(directory, 'legacy-cutover'))).toBe(false)
    await registry.close()

    const restarted = await openRegistry(directory, { ownerToken: 'registry-owner-b' })
    expect(restarted.legacy.recoveryNotices()).toMatchObject({
      revision: 1,
      notices: [{ recoveryKey: 'recovery-1', status: 'unresolved' }]
    })
    await expect(restarted.legacy.importMigration(request)).resolves.toMatchObject({
      duplicate: true,
      receipt: { sequence: 1 }
    })
    await expect(
      restarted.legacy.importMigration({ ...request, requestedAtMs: request.requestedAtMs + 1 })
    ).rejects.toMatchObject({ code: 'operation-conflict' })
    expect(readAuthorityLog(directory, namespace)).toHaveLength(1)
  })

  it('restores imported bindings, recovery projection, and worker routing from one checkpoint', async () => {
    const directory = freshDirectory()
    const registry = await openRegistry(directory)
    const namespace = await resolveNamespace(registry, 1)
    await registry.legacy.importMigration(mixedCutoverRequest(namespace))
    const service = await registry.openNamespace(namespace)
    await service.compact(service.writerAccess)
    const checkpoint = readCheckpoint(directory, namespace)
    expect(checkpoint.snapshot).toMatchObject({
      revision: 1,
      legacyMigrations: [
        {
          receipt: {
            request: { mode: 'cutover', workerRoute: { routeId: 'route-1' } },
            recoveries: [
              { status: 'imported', binding: { physicalPtyId: 'pty-1' } },
              { status: 'unresolved', recoveryId: 'recovery-2' }
            ]
          }
        }
      ]
    })
    expect(checkpoint.snapshot.catalogReceiptIds).toBeUndefined()
    await registry.close()

    const restarted = await openRegistry(directory, { ownerToken: 'registry-owner-b' })
    expect(restarted.legacy.projection()).toMatchObject({
      revision: 1,
      workers: [{ routeId: 'route-1' }],
      recoveries: [
        { recoveryId: 'recovery-1', status: 'imported' },
        { recoveryId: 'recovery-2', status: 'unresolved' }
      ]
    })
    expect(restarted.legacy.physicalWorkerEntries()).toMatchObject([
      { route: { routeId: 'route-1' }, cutover: { kind: 'posix-relocated' } }
    ])
    expect(restarted.legacy.gcProtection().relayDirectories).toEqual(['/relay/1'])
    const restored = await restarted.openNamespace(namespace)
    const observer = restored.observe('legacy-checkpoint-observer')
    expect(restored.snapshotForObserver(observer)).toMatchObject({
      revision: 1,
      panes: [{ paneKey: 'pane-1', ownerStatus: 'owner-unreachable' }]
    })
    const recoveryPane = {
      paneKey: 'recovery-target',
      paneGenerationId: 'recovery-target-generation'
    }
    await restored.mutate(restored.writerAccess, {
      actorId: restored.writerAccess.actorId,
      ...terminalAuthorityOperationIdentity(1, 'recovery-target-create'),
      baseRevision: 1,
      change: { kind: 'create', pane: recoveryPane }
    })
    await expect(
      restored.mutate(restored.writerAccess, {
        actorId: restored.writerAccess.actorId,
        ...terminalAuthorityOperationIdentity(2, 'recovery-target-prepare'),
        baseRevision: 2,
        change: {
          kind: 'prepare-allocation',
          allocation: {
            allocationId: 'recovery-target-allocation',
            pane: recoveryPane,
            ownerIncarnationId: 'legacy-owner-1',
            physicalPtyId: 'pty-2',
            spawnFingerprint: 'recovery-target-spawn'
          },
          expected: { paneGenerationId: recoveryPane.paneGenerationId, binding: null }
        }
      })
    ).rejects.toMatchObject({ code: 'allocation-conflict' })
  })

  it('keeps ambiguous rows visible until an acknowledgement authority operation', async () => {
    const directory = freshDirectory()
    const registry = await openRegistry(directory)
    const namespace = await resolveNamespace(registry, 1)
    const unresolved = await registry.legacy.importMigration(
      legacyRecoveryOnlyRequest({
        migrationNumber: 1,
        namespace,
        unresolvedPaneKey: 'legacy-ambiguous-pane'
      })
    )
    const service = await registry.openNamespace(namespace)
    const observer = service.observe('unresolved-observer')
    expect(service.snapshotForObserver(observer).panes).toEqual([])
    await expect(
      service.mutate(service.writerAccess, {
        actorId: service.writerAccess.actorId,
        ...terminalAuthorityOperationIdentity(1, 'unrelated-create'),
        baseRevision: 1,
        change: {
          kind: 'create',
          pane: { paneKey: 'unrelated-pane', paneGenerationId: 'unrelated-generation' }
        }
      })
    ).resolves.toMatchObject({ result: { revision: 2 } })
    await expect(
      service.mutate(service.writerAccess, {
        actorId: service.writerAccess.actorId,
        ...terminalAuthorityOperationIdentity(2, 'ambiguous-create'),
        baseRevision: 2,
        change: {
          kind: 'create',
          pane: { paneKey: 'legacy-ambiguous-pane', paneGenerationId: 'new-generation' }
        }
      })
    ).rejects.toMatchObject({ code: 'expectation-mismatch' })
    await expect(
      registry.legacy.importMigration(legacyAcknowledgementRequest(2, 1, 'wrong-operation'))
    ).rejects.toMatchObject({ code: 'expectation-mismatch' })

    await expect(
      registry.legacy.importMigration(
        legacyAcknowledgementRequest(2, 1, unresolved.receipt.receiptId)
      )
    ).resolves.toMatchObject({
      duplicate: false,
      receipt: {
        sequence: 2,
        recoveries: [{ status: 'acknowledged', previousCatalogReceiptId: 'migration-1' }]
      }
    })
    await expect(
      service.mutate(service.writerAccess, {
        actorId: service.writerAccess.actorId,
        ...terminalAuthorityOperationIdentity(3, 'acknowledged-create'),
        baseRevision: 3,
        change: {
          kind: 'create',
          pane: { paneKey: 'legacy-ambiguous-pane', paneGenerationId: 'acknowledged-generation' }
        }
      })
    ).resolves.toMatchObject({ result: { revision: 4 } })
    // An observer reads the ledger; it never becomes a durable consumer, so no claim is appended.
    expect(readAuthorityLog(directory, namespace).map((record) => record.event.kind)).toEqual([
      'legacy-migration',
      'mutation',
      'legacy-migration',
      'mutation'
    ])
    await service.compact(service.writerAccess)
    await registry.close()

    const restarted = await openRegistry(directory, { ownerToken: 'registry-owner-b' })
    expect(restarted.legacy.recoveryNotices()).toMatchObject({
      revision: 2,
      notices: [{ recoveryKey: 'recovery-1', status: 'acknowledged' }]
    })
    expect(restarted.legacy.gcProtection()).toEqual({ relayDirectories: [], evidencePaths: [] })
  })

  it('commits a multi-namespace inventory independently and retries the exact suffix', async () => {
    const directory = freshDirectory()
    let nextNamespace = 0
    const registry = await openRegistry(directory, {
      createNamespaceId: () => `namespace-${++nextNamespace}`,
      maxLogBytes: 6_000
    })
    const namespaceA = await resolveNamespace(registry, 1)
    const namespaceB = await resolveNamespace(registry, 2)
    const request = multiNamespaceRequest(namespaceA, namespaceB)

    await expect(registry.legacy.importMigration(request)).rejects.toMatchObject({
      code: 'capacity'
    })
    expect(registry.legacy.recoveryNoticesForNamespace(namespaceA).notices).toMatchObject([
      { recoveryKey: 'recovery-1', status: 'unresolved' }
    ])
    expect(registry.legacy.recoveryNoticesForNamespace(namespaceB).notices).toEqual([])
    expect(readAuthorityLog(directory, namespaceA)).toHaveLength(1)
    expect(readAuthorityLog(directory, namespaceB)).toHaveLength(0)
    await registry.close()

    const restarted = await openRegistry(directory, { ownerToken: 'registry-owner-b' })
    const completed = await restarted.legacy.importMigration(request)
    expect(completed).toMatchObject({
      duplicate: false,
      receipt: { sequence: 1 }
    })
    const notices = restarted.legacy.recoveryNotices()
    expect(notices.revision).toBe(2)
    expect(notices.notices.map((notice) => notice.recoveryKey)).toEqual(
      expect.arrayContaining(['recovery-1', 'recovery-10'])
    )
    expect(notices.notices).toHaveLength(10)
    const duplicate = await restarted.legacy.importMigration(request)
    expect(duplicate).toMatchObject({
      duplicate: true,
      receipt: { sequence: 1 }
    })
    expect(duplicate.receipt).toEqual(completed.receipt)

    const namespaceC = await resolveNamespace(restarted, 11)
    await expect(
      restarted.legacy.importMigration(
        legacyRecoveryOnlyRequest({
          migrationNumber: 1,
          workerNumber: 2,
          recoveryNumbers: [11],
          namespace: namespaceC
        })
      )
    ).rejects.toMatchObject({ code: 'operation-conflict' })
  })
})

async function openRegistry(
  directory: string,
  overrides: Partial<Parameters<typeof TerminalSessionAuthorityRegistry.open>[0]> = {}
): Promise<TerminalSessionAuthorityRegistry> {
  const registry = await TerminalSessionAuthorityRegistry.open({
    directory,
    authorityHostId: 'host-a',
    ownerToken: 'registry-owner-a',
    ownerIncarnationId: 'authority-owner-a',
    writerActorId: 'authority-writer-a',
    ...overrides
  })
  registries.push(registry)
  return registry
}

async function resolveNamespace(
  registry: TerminalSessionAuthorityRegistry,
  number: number
): Promise<TerminalAuthorityNamespace> {
  return (
    await registry.resolveNamespace({
      kind: 'workspace',
      canonicalPath: `/repo/${number}`,
      pathFlavor: 'posix'
    })
  ).namespace
}

function multiNamespaceRequest(
  namespaceA: TerminalAuthorityNamespace,
  namespaceB: TerminalAuthorityNamespace
): TerminalLegacyMigrationImportRequest {
  const first = legacyRecoveryOnlyRequest({
    migrationNumber: 1,
    workerNumber: 1,
    recoveryNumbers: [1],
    namespace: namespaceA
  })
  const suffix = legacyRecoveryOnlyRequest({
    migrationNumber: 1,
    workerNumber: 1,
    recoveryNumbers: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    namespace: namespaceB
  })
  if (first.mode !== 'recovery-only' || suffix.mode !== 'recovery-only') {
    throw new Error('invalid legacy test fixture')
  }
  return Object.freeze({
    ...first,
    unresolved: Object.freeze([
      ...first.unresolved,
      ...suffix.unresolved.map((candidate): TerminalLegacyUnresolvedCandidate => {
        if (candidate.workspace.kind !== 'folder') {
          throw new Error('invalid legacy workspace test fixture')
        }
        return Object.freeze({
          ...candidate,
          workspace: Object.freeze({
            kind: 'folder' as const,
            locator: Object.freeze({
              kind: 'workspace' as const,
              canonicalPath: '/repo/2',
              pathFlavor: 'posix' as const
            })
          })
        })
      })
    ])
  })
}

function mixedCutoverRequest(
  namespace: TerminalAuthorityNamespace
): TerminalLegacyMigrationImportRequest {
  const request = legacyCutoverRequest({
    migrationNumber: 1,
    workerNumber: 1,
    importedRecoveryNumbers: [1],
    unresolvedRecoveryNumbers: [2],
    namespace
  })
  if (request.mode !== 'cutover') {
    throw new Error('invalid legacy cutover test fixture')
  }
  const unresolved = request.unresolved[0]!
  if (unresolved.workspace.kind !== 'folder') {
    throw new Error('invalid legacy workspace test fixture')
  }
  return Object.freeze({
    ...request,
    unresolved: Object.freeze([
      Object.freeze({
        ...unresolved,
        workspace: Object.freeze({
          kind: 'folder' as const,
          locator: Object.freeze({
            kind: 'workspace' as const,
            canonicalPath: '/repo/1',
            pathFlavor: 'posix' as const
          })
        })
      })
    ])
  })
}

function readAuthorityLog(
  directory: string,
  namespace: TerminalAuthorityNamespace
): TerminalSessionAuthorityLogRecord[] {
  const file = path.join(
    terminalSessionAuthorityNamespaceDirectory(directory, namespace),
    TERMINAL_AUTHORITY_LOG_FILE
  )
  const contents = readFileSync(file, 'utf8').trim()
  return contents
    ? contents.split('\n').map((line) => JSON.parse(line) as TerminalSessionAuthorityLogRecord)
    : []
}

function readCheckpoint(directory: string, namespace: TerminalAuthorityNamespace) {
  return JSON.parse(
    readFileSync(
      path.join(
        terminalSessionAuthorityNamespaceDirectory(directory, namespace),
        TERMINAL_AUTHORITY_CHECKPOINT_FILE
      ),
      'utf8'
    )
  )
}

function freshDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'orca-legacy-authority-'))
  directories.push(directory)
  return directory
}
