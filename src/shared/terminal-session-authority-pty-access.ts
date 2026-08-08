import {
  assertAuthorityNamespace,
  assertPaneGeneration,
  assertTerminalBinding,
  isRecord,
  sameTerminalBinding,
  type TerminalAuthorityNamespace,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'

export type TerminalSessionAuthorityPtyAccess = Readonly<{
  namespace: TerminalAuthorityNamespace
  pane: TerminalPaneGeneration
  binding: TerminalSessionBinding
}>

export function parseTerminalSessionAuthorityPtyAccess(
  value: unknown
): TerminalSessionAuthorityPtyAccess | null {
  if (!isRecord(value)) {
    return null
  }
  try {
    assertAuthorityNamespace(value.namespace)
    assertPaneGeneration(value.pane)
    assertTerminalBinding(value.binding)
  } catch {
    return null
  }
  return Object.freeze({
    namespace: Object.freeze({ ...value.namespace }),
    pane: Object.freeze({ ...value.pane }),
    binding: Object.freeze({ ...value.binding })
  })
}

export function sameTerminalSessionAuthorityPtyAccess(
  left: TerminalSessionAuthorityPtyAccess | null,
  right: TerminalSessionAuthorityPtyAccess
): boolean {
  return Boolean(
    left &&
    left.namespace.authorityHostId === right.namespace.authorityHostId &&
    left.namespace.namespaceId === right.namespace.namespaceId &&
    left.pane.paneKey === right.pane.paneKey &&
    left.pane.paneGenerationId === right.pane.paneGenerationId &&
    sameTerminalBinding(left.binding, right.binding)
  )
}
