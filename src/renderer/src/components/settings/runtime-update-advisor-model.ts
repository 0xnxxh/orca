// Why: pure derivation of the advisor's view model from the compat verdict and
// the blocked server's status. Kept out of the React component so the
// verdict-branching logic (client-too-old renders no server commands) can be
// unit-tested without rendering, and so the trust boundary — always running raw
// `status.updateInfo` through the shared validator — lives in one place.

import type { RuntimeCompatVerdict } from '../../../../shared/protocol-compat'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import {
  buildRuntimeUpdateGuide,
  type RuntimeUpdateGuide,
  type RuntimeUpdateGuideInput
} from '../../../../shared/runtime-update-guide'
import { validateRuntimeUpdateInfo } from '../../../../shared/runtime-update-info-validation'

export type RuntimeUpdateAdvisorModelInput = {
  verdict: RuntimeCompatVerdict
  status: RuntimeStatus
  /** Port from the client's own paired endpoint — a hint the guide falls back
   *  from when absent. Never sourced from server metadata. */
  portHint?: number
}

/**
 * Derive the guide-matrix input from the verdict + status. `status.updateInfo`
 * is untrusted server data, so it always passes through `validateRuntimeUpdateInfo`
 * before any field selects a template or fills a placeholder. `assetUrl` is left
 * unset — a later unit supplies exact release asset URLs.
 */
export function deriveRuntimeUpdateGuideInput(
  input: RuntimeUpdateAdvisorModelInput
): RuntimeUpdateGuideInput {
  const validated = validateRuntimeUpdateInfo(input.status.updateInfo)
  return {
    verdict: input.verdict,
    hostPlatform: input.status.hostPlatform,
    installKind: validated.installKind,
    restartKind: validated.restartKind,
    hostArch: validated.hostArch,
    serviceName: validated.serviceName,
    installPath: validated.installPath,
    currentVersion: validated.currentVersion,
    latestVersion: validated.latestVersion,
    updateAvailable: validated.updateAvailable,
    docsUrl: validated.docsUrl,
    port: input.portHint
  }
}

/** null when the verdict is not a block: the advisor renders nothing. */
export function buildRuntimeUpdateAdvisorGuide(
  input: RuntimeUpdateAdvisorModelInput
): RuntimeUpdateGuide | null {
  return buildRuntimeUpdateGuide(deriveRuntimeUpdateGuideInput(input))
}

/**
 * Best-effort port hint parsed from the client-owned paired endpoint string
 * (e.g. `wss://host:6768/...`). Returns undefined when the endpoint carries no
 * explicit port or cannot be parsed, so the guide uses its documented default.
 */
export function parseEndpointPortHint(endpoint: string | undefined | null): number | undefined {
  if (!endpoint) {
    return undefined
  }
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return undefined
  }
  if (!parsed.port) {
    return undefined
  }
  const port = Number(parsed.port)
  return Number.isInteger(port) ? port : undefined
}
