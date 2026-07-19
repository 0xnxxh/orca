import { join } from 'node:path'
import {
  createManagedCommandMatcher,
  MANAGED_HOOK_TIMEOUT_SECONDS,
  readHooksJson
} from '../agent-hooks/installer-utils'
import { getCodexManagedScriptFileName } from '../codex/codex-hook-identity'
import { getCodexManagedHookInstallMaterial } from '../codex/hook-service'
import { grantManagedCodexHookTrust } from '../codex/codex-hook-trust-grant'
import { removeCodexManagedHookTrustEntries } from '../codex/codex-managed-trust-reconciliation'
import { getSystemCodexHomePath } from '../codex/codex-home-paths'
import {
  getCodexExplicitHomeHookSourcePath,
  type CodexTrustEntry
} from '../codex/config-toml-trust'

// Why: the overlay home symlinks hooks.json to the user's real ~/.codex/hooks.json,
// so the Orca status hook it inherits must be trusted PER overlay. Codex derives
// the trust key from the explicit CODEX_HOME (the overlay dir, canonicalized) with
// a logical hooks.json leaf — NOT the symlink target — so every overlay produces a
// distinct [hooks.state] key that all land in the shared real config.toml. This
// module grants that trust on account creation and sweeps it on account removal.

function getOverlayHooksJsonPath(overlayHomePath: string): string {
  return join(overlayHomePath, 'hooks.json')
}

/**
 * Reads the (symlinked) overlay hooks.json and returns the managed Orca-status
 * hook trust entries codex would compute for THIS overlay CODEX_HOME. Empty when
 * the shared hooks.json holds no Orca-managed hook yet — the grant then no-ops.
 */
export function findManagedOverlayHookTrustEntries(overlayHomePath: string): CodexTrustEntry[] {
  const material = getCodexManagedHookInstallMaterial()
  const overlayHooksPath = getOverlayHooksJsonPath(overlayHomePath)
  const config = readHooksJson(overlayHooksPath)
  if (!config?.hooks) {
    return []
  }
  // Why: the reported key canonicalizes the overlay home dir but keeps the
  // hooks.json leaf logical, so build entries against that exact source path.
  const sourcePath = getCodexExplicitHomeHookSourcePath(overlayHooksPath)
  const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const entries: CodexTrustEntry[] = []
  for (const eventName of material.events) {
    const definitions = config.hooks[eventName]
    if (!Array.isArray(definitions)) {
      continue
    }
    definitions.forEach((definition, groupIndex) => {
      const hooks = Array.isArray(definition.hooks) ? definition.hooks : []
      hooks.forEach((hook, handlerIndex) => {
        if (!isManagedCommand(hook.command)) {
          return
        }
        entries.push({
          sourcePath,
          eventLabel: material.eventLabel[eventName],
          groupIndex,
          handlerIndex,
          command: material.command,
          timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
        })
      })
    })
  }
  return entries
}

/**
 * Grants trust for the overlay's inherited managed hook through codex's own
 * app-server, keyed to the overlay CODEX_HOME. The granted [hooks.state] entry
 * lands in the shared real config.toml (reached through the overlay's symlinked
 * config.toml). Never throws; a no-op when the shared hooks.json has no Orca hook.
 */
export function grantManagedCodexOverlayHookTrust(overlayHomePath: string): void {
  try {
    const managedEntries = findManagedOverlayHookTrustEntries(overlayHomePath)
    if (managedEntries.length === 0) {
      return
    }
    const material = getCodexManagedHookInstallMaterial()
    grantManagedCodexHookTrust({
      // Why: ledger + config reads are scoped to the overlay CODEX_HOME; codex is
      // launched with CODEX_HOME=overlay, so this is an explicit-home grant.
      runtimeHomePath: overlayHomePath,
      tomlPath: join(overlayHomePath, 'config.toml'),
      managedCommand: material.command,
      managedEntries,
      host: { kind: 'native' }
    })
  } catch (error) {
    // Why: hook trust is best-effort. A grant failure must never block adding,
    // re-authing, or selecting a Codex account.
    console.warn('[codex-overlay-hooks] Failed to grant overlay hook trust:', error)
  }
}

/**
 * Sweeps the overlay's Orca-managed [hooks.state] entry out of the SHARED real
 * config.toml on account removal, so a deleted overlay leaves no orphan trust
 * record behind. Ownership is proven by the Codex-computed hash or grant ledger,
 * so a user's own trust at a colliding key is never touched. Never throws.
 *
 * Must run while the overlay directory still exists so the explicit-home key can
 * be canonicalized to match what codex recorded.
 */
export function sweepManagedCodexOverlayHookTrust(overlayHomePath: string): void {
  try {
    const material = getCodexManagedHookInstallMaterial()
    removeCodexManagedHookTrustEntries({
      tomlPath: join(getSystemCodexHomePath(), 'config.toml'),
      runtimeHomePath: overlayHomePath,
      sourcePath: getOverlayHooksJsonPath(overlayHomePath),
      sourceUsesExplicitCodexHome: true,
      command: material.command,
      managedEventLabels: new Set(Object.values(material.eventLabel)),
      timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
    })
  } catch (error) {
    console.warn('[codex-overlay-hooks] Failed to sweep overlay hook trust:', error)
  }
}
