import type { DaemonEndpointIdentity } from './daemon-hello-protocol'

export const WINDOWS_CREATION_TIME_TOLERANCE_MS = 10_000

// Oracle contract validated 2026-07-29; omitted proofs remain unknown.
export const DAEMON_GONE_PROOFS = {
  linux: [
    'pid_missing',
    'boot_identity_changed',
    'raw_start_ticks_mismatch',
    'matching_identity_zombie'
  ],
  darwin: ['pid_missing'],
  win32: ['cim_process_missing', 'cim_creation_time_mismatch', 'named_pipe_missing']
} as const

export type DaemonEvidenceSource =
  | 'authenticated_inventory'
  | 'boot_identity'
  | 'endpoint_identity'
  | 'endpoint_stat'
  | 'linux_proc_stat'
  | 'pid_record'
  | 'process_command_line'
  | 'process_signal'
  | 'process_start_time'
  | 'token_file'
  | 'windows_cim'
  | 'windows_named_pipe'

export type DaemonEvidenceSources = readonly [DaemonEvidenceSource, ...DaemonEvidenceSource[]]

export type ExactDaemonIncarnation = {
  identity: DaemonEndpointIdentity
  linuxStartTicks?: string
  bootId?: string
}

export type DaemonProcessEvidence =
  | {
      state: 'present'
      reason: 'linux_identity_match' | 'macos_identity_match' | 'windows_identity_match'
      evidenceSources: DaemonEvidenceSources
    }
  | {
      state: 'gone'
      reason:
        | 'linux_boot_changed'
        | 'linux_start_ticks_mismatch'
        | 'linux_zombie'
        | 'pid_missing'
        | 'windows_creation_time_mismatch'
        | 'windows_process_missing'
      evidenceSources: DaemonEvidenceSources
      exactIncarnation: ExactDaemonIncarnation
    }
  | {
      state: 'unknown'
      reason:
        | 'command_line_mismatch'
        | 'command_line_unavailable'
        | 'exact_identity_unavailable'
        | 'inspection_failed'
        | 'linux_identity_incomplete'
        | 'macos_start_time_mismatch'
        | 'permission_denied'
        | 'process_start_time_unavailable'
        | 'windows_command_line_unavailable'
        | 'windows_process_start_time_unavailable'
      evidenceSources: DaemonEvidenceSources
    }

export type ProcessSignalEvidence = 'occupied' | 'permission_denied' | 'missing' | 'unavailable'

export type LinuxStatEvidence =
  | { status: 'present'; value: string }
  | { status: 'missing' }
  | { status: 'unavailable' }

export type WindowsProcessEvidence =
  | { status: 'present'; commandLine: string | null; startedAtMs: number | null }
  | { status: 'missing' }
  | { status: 'unavailable' }

export type DaemonProcessProbeDependencies = {
  platform?: NodeJS.Platform
  signalProcess?: (pid: number) => ProcessSignalEvidence
  readLinuxStat?: (pid: number) => Promise<LinuxStatEvidence>
  readBootIdentity?: () => Promise<string | undefined>
  readCommandLine?: (pid: number, platform: NodeJS.Platform) => Promise<string | undefined>
  readProcessStartedAtMs?: (pid: number) => number | null
  queryWindowsProcess?: (pid: number) => Promise<WindowsProcessEvidence>
}
