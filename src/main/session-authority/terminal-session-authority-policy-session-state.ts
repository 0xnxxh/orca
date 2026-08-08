import type { TerminalAuthorityNamespace } from '../../shared/terminal-session-authority-identity'
import type { TerminalSessionAuthorityPolicyNamespacePump } from './terminal-session-authority-policy-namespace-pump'
import type { TerminalAuthorityPolicyOutcomeTransport } from './terminal-session-authority-policy-outcome-transport'

export type TerminalAuthorityPolicyNamespaceOpening = Readonly<{
  pump: TerminalSessionAuthorityPolicyNamespacePump
  ready: Promise<TerminalSessionAuthorityPolicyNamespacePump>
}>

export function terminalAuthorityPolicyNamespaceKey(namespace: TerminalAuthorityNamespace): string {
  return JSON.stringify([namespace.authorityHostId, namespace.namespaceId])
}

export function terminalAuthorityPolicyNamespaceIsInstalled(
  active: boolean,
  installedNamespaces: ReadonlySet<string>,
  namespace: TerminalAuthorityNamespace,
  assertNamespaceCurrent: (namespace: TerminalAuthorityNamespace) => void
): boolean {
  if (!active || !installedNamespaces.has(terminalAuthorityPolicyNamespaceKey(namespace))) {
    return false
  }
  try {
    assertNamespaceCurrent(namespace)
    return true
  } catch {
    return false
  }
}

export function notifyTerminalAuthorityPolicyConsumerFailure(
  transport: TerminalAuthorityPolicyOutcomeTransport,
  value: unknown
): void {
  const error = value instanceof Error ? value : new Error(String(value))
  try {
    transport.onFailure?.(error)
  } catch {
    // The exact connection is already fenced.
  }
}
