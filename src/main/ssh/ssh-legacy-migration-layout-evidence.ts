import { isRecord } from '../../shared/terminal-session-authority-identity'
import { isTerminalLeafId, makePaneKey } from '../../shared/stable-pane-id'
import {
  SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY,
  boundedSshLegacyRecordEntries,
  failSshLegacyMigrationEvidence
} from './ssh-legacy-migration-evidence-capacity'

export type SshLegacyLayoutBinding = Readonly<{
  leafId: string
  paneKey: string
  ptyId: string
}>

export function collectSshLegacyLayoutBindings(args: {
  tabId: string
  fallbackPtyId: string | null
  layout: unknown
}): readonly SshLegacyLayoutBinding[] {
  if (args.layout === undefined) {
    return []
  }
  if (!isRecord(args.layout)) {
    failSshLegacyMigrationEvidence('malformed', 'terminal layout')
  }
  const leafIds = collectLayoutLeafIds(args.layout.root)
  const bindingEntries =
    args.layout.ptyIdsByLeafId === undefined
      ? []
      : boundedSshLegacyRecordEntries(
          args.layout.ptyIdsByLeafId,
          SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.bindingsPerLayout,
          'terminal layout bindings'
        )
  if (bindingEntries.length === 0) {
    const onlyLeafId = leafIds.size === 1 ? [...leafIds][0] : null
    return args.fallbackPtyId && onlyLeafId
      ? [makeBinding(args.tabId, onlyLeafId, args.fallbackPtyId)]
      : []
  }
  return bindingEntries.map(([leafId, ptyId]) => {
    if (typeof ptyId !== 'string' || !leafIds.has(leafId)) {
      failSshLegacyMigrationEvidence('malformed', 'terminal pane binding')
    }
    return makeBinding(args.tabId, leafId, ptyId)
  })
}

function collectLayoutLeafIds(root: unknown): ReadonlySet<string> {
  if (root === null) {
    return new Set()
  }
  if (!isRecord(root)) {
    failSshLegacyMigrationEvidence('malformed', 'terminal layout root')
  }
  const leafIds = new Set<string>()
  const pending: unknown[] = [root]
  let scanned = 0
  while (pending.length > 0) {
    scanned += 1
    if (scanned > SSH_LEGACY_MIGRATION_EVIDENCE_CAPACITY.layoutNodes) {
      failSshLegacyMigrationEvidence('capacity', 'terminal layout nodes')
    }
    const node = pending.pop()
    if (!isRecord(node)) {
      failSshLegacyMigrationEvidence('malformed', 'terminal layout node')
    }
    if (node.type === 'leaf') {
      if (typeof node.leafId !== 'string' || !isTerminalLeafId(node.leafId)) {
        failSshLegacyMigrationEvidence('malformed', 'terminal leaf identity')
      }
      if (leafIds.has(node.leafId)) {
        failSshLegacyMigrationEvidence('ambiguity', 'terminal leaf identity')
      }
      leafIds.add(node.leafId)
      continue
    }
    if (node.type !== 'split') {
      failSshLegacyMigrationEvidence('malformed', 'terminal layout node kind')
    }
    pending.push(node.first, node.second)
  }
  return leafIds
}

function makeBinding(tabId: string, leafId: string, ptyId: string): SshLegacyLayoutBinding {
  if (!tabId || !ptyId || !isTerminalLeafId(leafId)) {
    failSshLegacyMigrationEvidence('malformed', 'terminal pane identity')
  }
  try {
    return Object.freeze({ leafId, paneKey: makePaneKey(tabId, leafId), ptyId })
  } catch {
    failSshLegacyMigrationEvidence('malformed', 'terminal pane identity')
  }
}
