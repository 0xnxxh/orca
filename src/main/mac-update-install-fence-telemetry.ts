import { eventSchemas, type EventName, type EventProps } from '../shared/telemetry-events'
import {
  consumeMacUpdateFenceDiagnostics,
  type MacUpdateFenceDiagnosticRecord
} from './mac-update-install-fence-diagnostics'
import { track } from './telemetry/client'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'

type MacUpdateFenceTelemetryEvent = Extract<EventName, `mac_update_fence_${string}`>

export function trackMacUpdateFenceEvent<N extends MacUpdateFenceTelemetryEvent>(
  event: N,
  props: EventProps<N>
): void {
  track(event, props)
}

export type MacUpdateFenceIngestResult = {
  /** Non-null when the previous update attempt terminally failed to install. */
  failedInstall: { targetVersion: string | null } | null
}

const INSTALL_FAILURE_RECOVERY_REASONS = new Set([
  'shipit_not_seen',
  'installer_exited_without_target',
  'absolute_timeout'
])

export function ingestMacUpdateFenceDiagnostics(): MacUpdateFenceIngestResult {
  let failedInstall: MacUpdateFenceIngestResult['failedInstall'] = null
  let targetObserved = false
  for (const record of consumeMacUpdateFenceDiagnostics()) {
    recordPersistedLifecycle(record)
    trackPersistedLifecycle(record)
    if (record.event === 'mac_update_fence_target_observed') {
      targetObserved = true
    }
    if (isInstallFailureRecord(record)) {
      failedInstall = {
        targetVersion: typeof record.targetVersion === 'string' ? record.targetVersion : null
      }
    }
  }
  // Why: the failing process exits before any UI exists, so the next startup
  // is the first chance to tell the user; a later target-observed record
  // means the install eventually landed and no failure notice is due.
  return { failedInstall: targetObserved ? null : failedInstall }
}

function isInstallFailureRecord(record: MacUpdateFenceDiagnosticRecord): boolean {
  if (record.event === 'mac_update_fence_post_commit_failure') {
    return true
  }
  return (
    record.event === 'mac_update_fence_recovered' &&
    typeof record.reason === 'string' &&
    INSTALL_FAILURE_RECOVERY_REASONS.has(record.reason)
  )
}

function recordPersistedLifecycle(record: MacUpdateFenceDiagnosticRecord): void {
  const { event, at, ...details } = record
  recordUpdaterLifecycle(event, { persistedAt: at, ...details })
}

function trackPersistedLifecycle(record: MacUpdateFenceDiagnosticRecord): void {
  const attemptProps = readAttemptProps(record)
  switch (record.event) {
    case 'mac_update_fence_armed':
    case 'mac_update_fence_monitor_ready':
    case 'mac_update_fence_awaiting_shipit':
    case 'mac_update_fence_shipit_seen':
    case 'mac_update_fence_target_observed': {
      if (!attemptProps) {
        return
      }
      const parsed = eventSchemas[record.event].safeParse(attemptProps)
      if (parsed.success) {
        track(record.event, parsed.data)
      }
      return
    }
    case 'mac_update_fence_preflight_blocked': {
      if (!attemptProps) {
        return
      }
      const parsed = eventSchemas.mac_update_fence_preflight_blocked.safeParse({
        ...attemptProps,
        blocker_mode: record.blockerMode
      })
      if (parsed.success) {
        track('mac_update_fence_preflight_blocked', parsed.data)
      }
      return
    }
    case 'mac_update_fence_launch_blocked': {
      if (!attemptProps) {
        return
      }
      const parsed = eventSchemas.mac_update_fence_launch_blocked.safeParse({
        ...attemptProps,
        phase: record.phase,
        reason: record.reason
      })
      if (parsed.success) {
        track('mac_update_fence_launch_blocked', parsed.data)
      }
      return
    }
    case 'mac_update_fence_recovered': {
      const parsed = eventSchemas.mac_update_fence_recovered.safeParse({
        ...attemptProps,
        reason: record.reason
      })
      if (parsed.success) {
        track('mac_update_fence_recovered', parsed.data)
      }
      return
    }
    case 'mac_update_fence_post_commit_failure': {
      const parsed = eventSchemas.mac_update_fence_post_commit_failure.safeParse({
        ...attemptProps,
        error_type: record.errorType
      })
      if (parsed.success) {
        track('mac_update_fence_post_commit_failure', parsed.data)
      }
    }
  }
}

function readAttemptProps(record: MacUpdateFenceDiagnosticRecord): {
  attempt_id: string
  source_version: string
  target_version: string
} | null {
  return typeof record.attemptId === 'string' &&
    typeof record.sourceVersion === 'string' &&
    typeof record.targetVersion === 'string'
    ? {
        attempt_id: record.attemptId,
        source_version: record.sourceVersion,
        target_version: record.targetVersion
      }
    : null
}
