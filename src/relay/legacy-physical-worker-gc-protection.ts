import type { TerminalLegacyGcProtection } from '../shared/terminal-legacy-cutover'

export function mergeLegacyPhysicalWorkerGcProtection(
  protections: readonly TerminalLegacyGcProtection[]
): TerminalLegacyGcProtection {
  const relayDirectories = new Set<string>()
  const evidencePaths = new Set<string>()
  for (const protection of protections) {
    protection.relayDirectories.forEach((entry) => relayDirectories.add(entry))
    protection.evidencePaths.forEach((entry) => evidencePaths.add(entry))
  }
  return Object.freeze({
    relayDirectories: Object.freeze([...relayDirectories].sort()),
    evidencePaths: Object.freeze([...evidencePaths].sort())
  })
}
