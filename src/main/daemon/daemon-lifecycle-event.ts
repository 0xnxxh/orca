// App-side emitters for the `daemon_lifecycle` telemetry event (STA-2376). Kept out of daemon-init
// so the replace/retire call sites stay one line and this stays a clean unit-test/mocking seam.
// No-op in dev/contributor builds (see telemetry/client `track`); rare in the field (≪1/user/day).

import {
  bucketDaemonLiveSessionCount,
  type DaemonReplaceReason,
  type DaemonRetireReason
} from '../../shared/daemon-lifecycle-telemetry'
import { track } from '../telemetry/client'

// Replaced a still-connectable daemon (startup launcher or runtime resolver-health path).
// `versionSkew` = pid-file appVersion differs from current app (omit when not version-driven).
export function trackDaemonReplaced(
  reason: DaemonReplaceReason,
  liveSessionCount: number | null,
  versionSkew?: boolean
): void {
  track('daemon_lifecycle', {
    transition: 'replaced',
    reason,
    live_session_count_bucket: bucketDaemonLiveSessionCount(liveSessionCount),
    ...(versionSkew === undefined ? {} : { version_skew: versionSkew })
  })
}

// Adapter observed the daemon die and forked a replacement; the app can't see the daemon-internal
// exit cause, so the live-session count is unknowable here and buckets to `unknown`.
export function trackDaemonRetired(reason: DaemonRetireReason): void {
  track('daemon_lifecycle', {
    transition: 'retired',
    reason,
    live_session_count_bucket: bucketDaemonLiveSessionCount(null)
  })
}
