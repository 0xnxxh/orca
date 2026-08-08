import {
  assertGraceTimeApplied,
  parseRelayGraceTimeSeconds
} from './terminal-authority-control-protocol'

export type RelayGraceTimeResult = Readonly<{ graceTimeMs: number }>

const RETAIN_AUTHORITY_GRACE_TIME_SECONDS = 0

export async function configureAcknowledgedRelayGraceTime(options: {
  params: Record<string, unknown>
  configureControl: (graceTimeSeconds: number) => RelayGraceTimeResult
  configureAuthority?: (graceTimeSeconds: number) => Promise<unknown>
}): Promise<RelayGraceTimeResult> {
  const graceTimeSeconds = parseRelayGraceTimeSeconds(options.params)
  if (options.configureAuthority) {
    // Older authority hosts still interpret finite grace as permission to terminate PTYs.
    const authorityResult = await options.configureAuthority(RETAIN_AUTHORITY_GRACE_TIME_SECONDS)
    assertGraceTimeApplied(authorityResult, RETAIN_AUTHORITY_GRACE_TIME_SECONDS)
  }
  const result = options.configureControl(graceTimeSeconds)
  assertGraceTimeApplied(result, graceTimeSeconds)
  return result
}
