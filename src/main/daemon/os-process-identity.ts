import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import {
  getProcessOutputFields,
  iterateProcessOutputLines
} from '../../shared/process-output-field-scanner'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from '../startup/startup-diagnostics'

const PS_IDENTITY_TIMEOUT_MS = 2_000
export const START_TIME_TOLERANCE_MS = 1_500

function getLinuxProcessStartedAtMs(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const startTicks = parseLinuxProcStartTicks(stat)
    const bootTimeSeconds = parseLinuxBootTimeSeconds(readFileSync('/proc/stat', 'utf8'))
    const ticksPerSecond = Number(
      execFileSync('getconf', ['CLK_TCK'], {
        encoding: 'utf8',
        timeout: 1_000
      }).trim()
    )
    if (
      !Number.isFinite(startTicks) ||
      !Number.isFinite(bootTimeSeconds) ||
      !Number.isFinite(ticksPerSecond) ||
      ticksPerSecond <= 0
    ) {
      return null
    }
    return bootTimeSeconds * 1000 + (startTicks / ticksPerSecond) * 1000
  } catch {
    return null
  }
}

export function parseLinuxProcStartTicks(stat: string): number {
  const commandEndIndex = stat.lastIndexOf(')')
  if (commandEndIndex === -1) {
    return Number.NaN
  }

  const fields = getProcessOutputFields(stat.slice(commandEndIndex + 1), 20)
  return Number(fields[19])
}

export function parseLinuxBootTimeSeconds(procStat: string): number {
  for (const line of iterateProcessOutputLines(procStat)) {
    if (!line.startsWith('btime ')) {
      continue
    }
    return Number(getProcessOutputFields(line, 2)[1])
  }
  return Number.NaN
}

export function getProcessStartedAtMs(pid: number): number | null {
  if (process.platform === 'linux') {
    return getLinuxProcessStartedAtMs(pid)
  }

  if (process.platform === 'win32') {
    // Why: the only OS source is a CIM query costing a powershell spawn —
    // too slow for this sync path. Windows pid files instead carry the
    // daemon's self-reported start time from its ready message, and
    // isDaemonProcess verifies it against CIM CreationDate asynchronously.
    return null
  }

  return getPsProcessIdentity(pid)?.startedAtMs ?? null
}

export function startTimeMatches(pid: number, expectedStartedAtMs: number | null): boolean {
  return startTimesWithinTolerance(
    getProcessStartedAtMs(pid),
    expectedStartedAtMs,
    START_TIME_TOLERANCE_MS
  )
}

// Why: fail open on null — a pid file or OS query without a start time must
// not veto an otherwise-matching daemon (adoption safety beats recycle safety).
export function startTimesWithinTolerance(
  actualStartedAtMs: number | null,
  expectedStartedAtMs: number | null,
  toleranceMs: number
): boolean {
  if (expectedStartedAtMs === null || actualStartedAtMs === null) {
    return true
  }
  return Math.abs(actualStartedAtMs - expectedStartedAtMs) <= toleranceMs
}

const execFileAsync = promisify(execFile)

export type WindowsProcessIdentity = {
  commandLine: string
  startedAtMs: number | null
}

export type PsProcessIdentity = {
  commandLine: string
  startedAtMs: number | null
}

export function parsePsProcessIdentity(output: string): PsProcessIdentity {
  // BSD ps formats lstart as a fixed-width 24-character timestamp.
  const startedAtMs = Date.parse(output.slice(0, 24))
  return {
    commandLine: output.slice(24).trim(),
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null
  }
}

function getPsProcessIdentity(pid: number): PsProcessIdentity | null {
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2_000
    })
    return parsePsProcessIdentity(output)
  } catch {
    return null
  }
}

export async function getPsProcessIdentityAsync(pid: number): Promise<PsProcessIdentity | null> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'ps',
        ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
        {
          encoding: 'utf8',
          timeout: PS_IDENTITY_TIMEOUT_MS
        },
        (error, output) => {
          if (error) {
            reject(error)
            return
          }
          resolve(output)
        }
      )
    })
    return parsePsProcessIdentity(stdout)
  } catch {
    return null
  }
}

export function parseWindowsProcessIdentityJson(stdout: string): WindowsProcessIdentity | null {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed) as { cmd?: unknown; start?: unknown }
    if (typeof parsed.cmd !== 'string' || !parsed.cmd) {
      return null
    }
    return {
      commandLine: parsed.cmd,
      startedAtMs:
        typeof parsed.start === 'number' && Number.isFinite(parsed.start) ? parsed.start : null
    }
  } catch {
    return null
  }
}

// Why: the only reliable command-line source on Windows is a CIM query, which
// costs a full powershell.exe spawn (300-800ms cold, worse under Defender).
// Async because the sync version measurably froze the Electron main thread at
// startup for the whole spawn (benchmark: ~0.5s warm, 3s timeout cap cold).
// CreationDate rides along in the same spawn so start-time verification adds
// zero extra process launches. Timed under ORCA_STARTUP_DIAGNOSTICS so the
// cold-start benchmark can attribute startup cost to these checks.
export async function queryWindowsProcessIdentity(
  pid: number
): Promise<WindowsProcessIdentity | null> {
  const startedAt = performance.now()
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
          `if ($p) { $start = $null; ` +
          `if ($p.CreationDate) { $start = [long]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }; ` +
          `@{ cmd = $p.CommandLine; start = $start } | ConvertTo-Json -Compress }`
      ],
      {
        encoding: 'utf8',
        timeout: 3_000
      }
    )
    return parseWindowsProcessIdentityJson(stdout)
  } catch {
    return null
  } finally {
    if (isStartupDiagnosticsEnabled()) {
      logStartupDiagnostic('daemon-pid-check', {
        t: Math.round(performance.now()),
        pid,
        ms: Math.round(performance.now() - startedAt)
      })
    }
  }
}
