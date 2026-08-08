import {
  assertAuthorityId,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from '../../shared/terminal-session-authority-identity'
import type {
  TerminalAuthorityProjection,
  TerminalPaneAuthorityProjection
} from '../../shared/terminal-session-authority-mutation'
import { terminalAuthorityNamespaceLocatorKey } from '../../shared/terminal-session-authority-locator'
import { parseTerminalSessionAuthorityAttachIdentity } from '../../shared/terminal-session-authority-wire'
import { terminalAuthorityLocatorForWorktreeId } from './terminal-session-authority-spawn-state'

export type TerminalAuthorityReattachIdentity = Readonly<{
  locator: ReturnType<typeof terminalAuthorityLocatorForWorktreeId>
  locatorKey: string
  paneKey: string
  pane: TerminalPaneGeneration
  physicalPtyId: string
  ptyIncarnationId: string
}>

export type TerminalAuthorityMissingPtyState =
  | Readonly<{ kind: 'unknown' | 'retired' }>
  | Readonly<{
      kind: 'reachable-record'
      ownerKind: 'current-owner' | 'imported-owner'
      pane: TerminalPaneGeneration
      binding: TerminalSessionBinding
    }>
  | Readonly<{
      kind: 'unreachable-predecessor'
      pane: TerminalPaneGeneration
      binding: TerminalSessionBinding
    }>

export function parseTerminalAuthorityReattachIdentity(
  params: Record<string, unknown>,
  physicalPtyId: string
): TerminalAuthorityReattachIdentity | null {
  const attach = parseTerminalSessionAuthorityAttachIdentity(params)
  if (!attach) {
    return null
  }
  assertAuthorityId(physicalPtyId, 'physicalPtyId')
  assertAuthorityId(attach.paneKey, 'paneKey')
  const locator = terminalAuthorityLocatorForWorktreeId(attach.worktreeId)
  return Object.freeze({
    locator,
    locatorKey: terminalAuthorityNamespaceLocatorKey(locator),
    paneKey: attach.paneKey,
    pane: Object.freeze({
      paneKey: attach.paneKey,
      paneGenerationId: `renderer:${attach.paneGeneration}`
    }),
    physicalPtyId,
    ptyIncarnationId: attach.ptyIncarnationId
  })
}

export function classifyTerminalAuthorityMissingPty(
  projection: TerminalAuthorityProjection,
  identity: TerminalAuthorityReattachIdentity,
  currentOwnerIncarnationId?: string
): TerminalAuthorityMissingPtyState {
  const exact = projection.panes.find(
    (pane) =>
      pane.paneKey === identity.paneKey &&
      samePane(pane, identity.pane) &&
      matchesExpectedBinding(pane.binding, identity)
  )
  if (exact?.binding) {
    return exact.ownerStatus === 'owner-unreachable'
      ? Object.freeze({
          kind: 'unreachable-predecessor',
          pane: Object.freeze({
            paneKey: exact.paneKey,
            paneGenerationId: exact.paneGenerationId
          }),
          binding: exact.binding
        })
      : Object.freeze({
          kind: 'reachable-record',
          ownerKind:
            exact.binding.ownerIncarnationId === currentOwnerIncarnationId
              ? ('current-owner' as const)
              : ('imported-owner' as const),
          pane: Object.freeze({
            paneKey: exact.paneKey,
            paneGenerationId: exact.paneGenerationId
          }),
          binding: exact.binding
        })
  }
  const retired = projection.panes.some(
    (pane) =>
      pane.paneKey === identity.paneKey &&
      matchesExpectedBinding(pane.lastBinding, identity) &&
      !matchesExpectedBinding(pane.binding, identity)
  )
  return Object.freeze({ kind: retired ? 'retired' : 'unknown' })
}

function samePane(
  pane: TerminalPaneAuthorityProjection,
  expected: TerminalPaneGeneration
): boolean {
  return pane.paneKey === expected.paneKey && pane.paneGenerationId === expected.paneGenerationId
}

function matchesExpectedBinding(
  binding: TerminalSessionBinding | null,
  identity: TerminalAuthorityReattachIdentity
): boolean {
  return Boolean(
    binding &&
    binding.physicalPtyId === identity.physicalPtyId &&
    binding.ptyIncarnationId === identity.ptyIncarnationId
  )
}
