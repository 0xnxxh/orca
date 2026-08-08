import { describe, expect, it } from 'vitest'
import type {
  TerminalPaneAuthorityRecord,
  TerminalSessionPtyAllocation
} from './terminal-session-authority-mutation'
import { TerminalSessionAuthorityTopology } from './terminal-session-authority-topology'

describe('terminal authority owner-scoped PTY indexes', () => {
  it('keeps identical physical and incarnation IDs distinct across owners', () => {
    const topology = new TerminalSessionAuthorityTopology('current-owner', 4, 4, () => true)
    const panes = [pane('pane-a', 'owner-a', 1), pane('pane-b', 'owner-b', 2)]
    const allocations = [allocation(panes[0]!, 'owner-a', 1), allocation(panes[1]!, 'owner-b', 2)]

    topology.restore(panes, allocations, 2)

    expect(topology.ptyOwner(panes[0]!.binding!)).toBe(JSON.stringify(['pane-a', 'generation']))
    expect(topology.ptyOwner(panes[1]!.binding!)).toBe(JSON.stringify(['pane-b', 'generation']))
    expect(topology.allocationSnapshot()).toHaveLength(2)
  })
})

function pane(
  paneKey: string,
  ownerIncarnationId: string,
  revision: number
): TerminalPaneAuthorityRecord {
  const binding = Object.freeze({
    ownerIncarnationId,
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  })
  return Object.freeze({
    paneKey,
    paneGenerationId: 'generation',
    status: 'open',
    binding,
    lastBinding: binding,
    revision
  })
}

function allocation(
  paneRecord: TerminalPaneAuthorityRecord,
  ownerIncarnationId: string,
  revision: number
): TerminalSessionPtyAllocation {
  return Object.freeze({
    allocationId: `allocation-${ownerIncarnationId}`,
    pane: Object.freeze({
      paneKey: paneRecord.paneKey,
      paneGenerationId: paneRecord.paneGenerationId
    }),
    ownerIncarnationId,
    physicalPtyId: 'pty-1',
    spawnFingerprint: `spawn-${ownerIncarnationId}`,
    intentActorId: `actor-${ownerIncarnationId}`,
    intentOperationId: `operation-${ownerIncarnationId}`,
    preparedAtRevision: revision,
    status: 'committed',
    binding: paneRecord.binding!,
    committedAtRevision: revision
  })
}
