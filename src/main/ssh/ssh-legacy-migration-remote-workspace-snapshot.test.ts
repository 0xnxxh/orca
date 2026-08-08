import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  SshLegacyMigrationEvidenceError,
  parseSshLegacyRemoteWorkspaceSnapshotEvidence
} from './ssh-legacy-migration-evidence-bridge'

const TARGET_ID = 'target-a'
const TAB_ID = 'tab-a'
const LEAF_ID = '00000000-0000-4000-8000-000000000001'
const APP_PTY_ID = toAppSshPtyId(TARGET_ID, 'pty-a')

describe('SSH legacy remote workspace snapshot evidence', () => {
  it('parses generation zero as independent pane evidence for each partition', () => {
    const snapshot = makeSnapshot()

    const first = parseSshLegacyRemoteWorkspaceSnapshotEvidence({
      targetId: TARGET_ID,
      partitionId: 'partition-first',
      snapshot
    })
    const second = parseSshLegacyRemoteWorkspaceSnapshotEvidence({
      targetId: TARGET_ID,
      partitionId: 'partition-second',
      snapshot
    })

    expect(first).toEqual([
      {
        targetId: TARGET_ID,
        partitionId: 'partition-first',
        ptyId: APP_PTY_ID,
        paneKey: makePaneKey(TAB_ID, LEAF_ID),
        tabId: TAB_ID,
        leafId: LEAF_ID,
        rendererGeneration: 0,
        workspaceReference: { kind: 'workspace-path', path: '/remote/private/repo' }
      }
    ])
    expect(second[0]).toEqual({ ...first[0], partitionId: 'partition-second' })
  })

  it('rejects duplicate tab identities and malformed path or binding evidence', () => {
    const duplicateTab = makeSnapshot({
      tabsByWorktreePath: {
        '/remote/one': [makeRemoteTab('/remote/one')],
        '/remote/two': [makeRemoteTab('/remote/two')]
      }
    })
    const malformedPath = makeSnapshot({
      tabsByWorktreePath: { '': [makeRemoteTab('')] }
    })
    const malformedBinding = makeSnapshot({
      terminalLayoutsByTabId: {
        [TAB_ID]: {
          ...makeLayout(),
          ptyIdsByLeafId: {
            '00000000-0000-4000-8000-000000000099': APP_PTY_ID
          }
        }
      }
    })

    expectEvidenceError(duplicateTab, 'ambiguity')
    expectEvidenceError(malformedPath, 'malformed')
    expectEvidenceError(malformedBinding, 'malformed')
  })

  it('rejects malformed snapshot shape without inventing missing evidence', () => {
    expectEvidenceError(
      {
        namespace: 'routing-namespace',
        session: { tabsByWorktreePath: {} }
      },
      'malformed'
    )

    const withoutGeneration = makeSnapshot({
      tabsByWorktreePath: {
        '/remote/private/repo': [makeRemoteTab('/remote/private/repo', false)]
      }
    })
    expect(
      parseSshLegacyRemoteWorkspaceSnapshotEvidence({
        targetId: TARGET_ID,
        partitionId: 'partition-a',
        snapshot: withoutGeneration
      })[0].rendererGeneration
    ).toBeNull()
  })

  it('rejects over-capacity tabs before scanning malformed tab entries', () => {
    const tabs = Array.from(
      { length: SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.tabsPerWorkspace + 1 },
      () => null
    )
    const snapshot = makeSnapshot({ tabsByWorktreePath: { '/remote/private/repo': tabs } })

    expectEvidenceError(snapshot, 'capacity')
  })
})

function expectEvidenceError(
  snapshot: unknown,
  code: InstanceType<typeof SshLegacyMigrationEvidenceError>['code']
): void {
  try {
    parseSshLegacyRemoteWorkspaceSnapshotEvidence({
      targetId: TARGET_ID,
      partitionId: 'partition-a',
      snapshot
    })
    throw new Error('expected snapshot evidence parsing to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(SshLegacyMigrationEvidenceError)
    expect(error).toMatchObject({ code })
  }
}

function makeSnapshot(
  overrides: {
    tabsByWorktreePath?: Readonly<Record<string, readonly unknown[]>>
    terminalLayoutsByTabId?: Readonly<Record<string, unknown>>
  } = {}
): unknown {
  return {
    namespace: 'client-routing-namespace',
    revision: 1,
    updatedAt: 1,
    schemaVersion: 1,
    session: {
      tabsByWorktreePath: overrides.tabsByWorktreePath ?? {
        '/remote/private/repo': [makeRemoteTab('/remote/private/repo')]
      },
      terminalLayoutsByTabId: overrides.terminalLayoutsByTabId ?? {
        [TAB_ID]: makeLayout()
      }
    }
  }
}

function makeRemoteTab(worktreePath: string, includeGeneration = true): unknown {
  return {
    id: TAB_ID,
    ptyId: APP_PTY_ID,
    worktreePath,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    ...(includeGeneration ? { generation: 0 } : {})
  }
}

function makeLayout(): Readonly<Record<string, unknown>> {
  return {
    root: { type: 'leaf', leafId: LEAF_ID },
    activeLeafId: LEAF_ID,
    expandedLeafId: null,
    ptyIdsByLeafId: { [LEAF_ID]: APP_PTY_ID }
  }
}
