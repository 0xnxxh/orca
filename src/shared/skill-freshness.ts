import type { SkillProvider, SkillSourceKind } from './skills'

export type SkillBundleFileIdentity = {
  path: string
  size: number
  executable: boolean
  classification: 'text' | 'binary'
  exactSha256: string
  textNormalizedSha256: string | null
  identitySha256: string
}

export type SkillKnownSnapshot = {
  releaseRevision: number
  packageDigest: string
  gitTreeSha: string
  files: SkillBundleFileIdentity[]
}

export type SkillCurrentBundleEntry = SkillKnownSnapshot & {
  name: string
  sourcePath: string
}

// Why: schema 2 removed the stamped app version so the committed artifact is a
// pure function of skills/ content; the running build supplies its own version.
export type SkillBundleManifest = {
  schemaVersion: 2
  skills: SkillCurrentBundleEntry[]
}

export type SkillSnapshotRegistry = {
  schemaVersion: 1
  skills: Record<string, SkillKnownSnapshot[]>
}

export type SkillReleaseMapping = {
  schemaVersion: 1
  releases: { appVersion: string; skills: Record<string, number> }[]
}

export type SkillFreshnessStatus =
  | 'current'
  | 'outdated'
  | 'newer-known'
  | 'unrecognized'
  | 'inaccessible'

export type SkillInstallationTopology =
  | 'canonical-copy'
  | 'provider-alias'
  | 'independent-copy'
  | 'external-link'
  | 'broken-link'
  | 'read-only'
  | 'repo-scope'
  | 'plugin-cache'

// Why: eligibility and the explanation copy must agree on which placements the
// validated npx rail can converge; a drifted copy would blame a phantom sibling.
export const SUPPORTED_GLOBAL_SKILL_TOPOLOGIES: ReadonlySet<SkillInstallationTopology> = new Set([
  'canonical-copy',
  'provider-alias'
])

export type SkillFreshnessInstallation = {
  id: string
  name: string
  rootId: string
  providers: SkillProvider[]
  sourceKind: SkillSourceKind
  sourceLabel: string
  unresolvedPath: string
  resolvedPath: string | null
  physicalIdentity: string | null
  topology: SkillInstallationTopology
  status: SkillFreshnessStatus
  installedReleaseRevision: number | null
  installedAppVersion: string | null
  currentReleaseRevision: number
  currentPackageDigest: string
  currentAppVersion: string
  observedPackageDigest: string | null
  errorCategory: string | null
}

export type SkillFreshnessInventory = {
  schemaVersion: 1
  installations: SkillFreshnessInstallation[]
  eligibleUpdateNames: string[]
  scannedAt: number
}

/** Whether the global update command writes to this placement. */
export function isConvergentSkillPlacement(installation: SkillFreshnessInstallation): boolean {
  return SUPPORTED_GLOBAL_SKILL_TOPOLOGIES.has(installation.topology)
}

/**
 * The single definition of drift: this copy is not the current official bytes.
 *
 * The badge, the review dialog and the skipped sentence all derive from this one
 * predicate, so a copy can never be amber on the badge and absent from the dialog.
 */
export function isDriftedSkillPlacement(installation: SkillFreshnessInstallation): boolean {
  return installation.status !== 'current'
}

/** Drift the update command cannot converge, so it needs the user's own hands. */
export function skillPlacementNeedsAttention(installation: SkillFreshnessInstallation): boolean {
  return (
    isDriftedSkillPlacement(installation) &&
    !(isConvergentSkillPlacement(installation) && installation.status === 'outdated')
  )
}

export function buildTargetedSkillUpdateCommand(names: readonly string[]): string | null {
  const canonicalNames = [...new Set(names)].sort((left, right) => left.localeCompare(right, 'en'))
  // Why: names become editable shell input. Official manifests use this
  // restricted package-name grammar so no entry can introduce shell syntax.
  if (canonicalNames.some((name) => !/^[a-z0-9][a-z0-9._-]*$/.test(name))) {
    return null
  }
  return canonicalNames.length > 0 ? `npx skills update ${canonicalNames.join(' ')} --global` : null
}
