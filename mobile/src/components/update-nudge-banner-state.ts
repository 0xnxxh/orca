// Why: decides the soft "update your app" nudge. Deliberately fail-open —
// any missing or unparsable version (older desktop, dev build) means no
// banner, because a wrong nudge is worse than no nudge.

function parseVersionSegments(version: string): number[] | null {
  const trimmed = version.trim()
  if (!/^\d+(\.\d+)*$/.test(trimmed)) {
    return null
  }
  return trimmed.split('.').map(Number)
}

// Why: numeric per-segment compare — string compare would rank 0.0.9 above
// 0.0.32. Missing segments count as 0 so 1.4 equals 1.4.0.
export function isAppVersionOlder(installed: string, recommended: string): boolean {
  const installedSegments = parseVersionSegments(installed)
  const recommendedSegments = parseVersionSegments(recommended)
  if (!installedSegments || !recommendedSegments) {
    return false
  }
  const length = Math.max(installedSegments.length, recommendedSegments.length)
  for (let index = 0; index < length; index++) {
    const installedSegment = installedSegments[index] ?? 0
    const recommendedSegment = recommendedSegments[index] ?? 0
    if (installedSegment !== recommendedSegment) {
      return installedSegment < recommendedSegment
    }
  }
  return false
}

export function shouldShowUpdateNudge(input: {
  recommendedVersion: string | null | undefined
  installedVersion: string | null | undefined
  dismissedVersion: string | null
  // Why: hold the banner until the dismissal read settles, so a user who
  // already dismissed this version never sees it flash on mount.
  dismissedLoaded: boolean
}): boolean {
  const { recommendedVersion, installedVersion, dismissedVersion, dismissedLoaded } = input
  if (!recommendedVersion || !installedVersion || !dismissedLoaded) {
    return false
  }
  // Why: dismissal is per-version — the nudge returns when a newer mobile
  // release ships and the desktop starts recommending a different version.
  if (dismissedVersion === recommendedVersion) {
    return false
  }
  return isAppVersionOlder(installedVersion, recommendedVersion)
}
