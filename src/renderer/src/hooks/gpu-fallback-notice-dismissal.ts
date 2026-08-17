const DISMISSED_ENGAGEMENT_KEY = 'orca.gpu-fallback.notice-dismissed-engaged-at'

/**
 * "Don't show again" for the Safe Graphics Mode notice, scoped to one engagement.
 *
 * Why scoped rather than a boolean: the downgrade is sticky for the whole build,
 * so a session-only dismissal nags on every launch for weeks. Storing the
 * engagement's `engagedAt` instead means a *new* engagement — after the user
 * cleared the fallback and the driver failed again — is still announced.
 */
export function isGpuFallbackNoticeDismissed(engagedAt: number | null): boolean {
  if (engagedAt === null) {
    return false
  }
  try {
    return window.localStorage.getItem(DISMISSED_ENGAGEMENT_KEY) === String(engagedAt)
  } catch {
    return false
  }
}

export function dismissGpuFallbackNotice(engagedAt: number | null): void {
  if (engagedAt === null) {
    return
  }
  try {
    window.localStorage.setItem(DISMISSED_ENGAGEMENT_KEY, String(engagedAt))
  } catch {
    // Best-effort; without storage the notice returns on the next launch.
  }
}
