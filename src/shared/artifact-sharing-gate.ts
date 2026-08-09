// Why: publishing an artifact mints a URL anyone can open, so agents get the capability only
// after the user grants it. The gate lives here so main, the CLI, and Settings share one contract.
import type { GlobalSettings } from './types'

export const ARTIFACT_SHARING_DISABLED_CODE = 'artifact_sharing_disabled'

export const ARTIFACT_SHARING_DISABLED_MESSAGE =
  'Artifact sharing is off for this device. Agents cannot publish public artifact links until you allow it.'

export const ARTIFACT_SHARING_DISABLED_NEXT_STEPS: readonly string[] = [
  'Open Settings → Artifacts in Orca.',
  'Turn on "Allow agents to publish artifacts".',
  'Run the share command again.'
]

export class ArtifactSharingDisabledError extends Error {
  readonly code = ARTIFACT_SHARING_DISABLED_CODE
  readonly data = { nextSteps: [...ARTIFACT_SHARING_DISABLED_NEXT_STEPS] }

  constructor() {
    super(ARTIFACT_SHARING_DISABLED_MESSAGE)
    this.name = 'ArtifactSharingDisabledError'
  }
}

/** Absent or non-`true` denies: an unmigrated profile must not inherit the capability. */
export function isArtifactSharingEnabled(
  settings: Pick<GlobalSettings, 'artifactSharingEnabled'> | null | undefined
): boolean {
  return settings?.artifactSharingEnabled === true
}

export function assertArtifactSharingAllowed(isEnabled: () => boolean): void {
  if (!isEnabled()) {
    throw new ArtifactSharingDisabledError()
  }
}
