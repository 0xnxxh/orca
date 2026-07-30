import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type {
  LinuxStatEvidence,
  ProcessSignalEvidence,
  WindowsProcessEvidence
} from './daemon-incarnation-evidence-types'

const execFileAsync = promisify(execFile)

export function inspectProcessSignal(pid: number): ProcessSignalEvidence {
  try {
    process.kill(pid, 0)
    return 'occupied'
  } catch (error) {
    if (hasErrorCode(error, 'ESRCH')) {
      return 'missing'
    }
    if (hasErrorCode(error, 'EPERM')) {
      return 'permission_denied'
    }
    return 'unavailable'
  }
}

export async function readLinuxStat(pid: number): Promise<LinuxStatEvidence> {
  try {
    return { status: 'present', value: await readFile(`/proc/${pid}/stat`, 'utf8') }
  } catch (error) {
    return { status: hasErrorCode(error, 'ENOENT') ? 'missing' : 'unavailable' }
  }
}

export async function readProcessCommandLine(
  pid: number,
  platform: NodeJS.Platform
): Promise<string | undefined> {
  if (platform === 'linux') {
    try {
      return await readFile(`/proc/${pid}/cmdline`, 'utf8')
    } catch {
      // Fall through to ps for procfs privilege or mount restrictions.
    }
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2_000
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export async function queryWindowsProcess(pid: number): Promise<WindowsProcessEvidence> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
          `if (!$p) { @{ exists = $false } | ConvertTo-Json -Compress } else { ` +
          `$start = $null; if ($p.CreationDate) { ` +
          `$start = [long]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }; ` +
          `@{ exists = $true; cmd = $p.CommandLine; start = $start } | ConvertTo-Json -Compress }`
      ],
      { encoding: 'utf8', timeout: 3_000 }
    )
    const parsed = JSON.parse(stdout.trim()) as {
      exists?: unknown
      cmd?: unknown
      start?: unknown
    }
    if (parsed.exists === false) {
      return { status: 'missing' }
    }
    if (parsed.exists !== true) {
      return { status: 'unavailable' }
    }
    return {
      status: 'present',
      commandLine: typeof parsed.cmd === 'string' && parsed.cmd ? parsed.cmd : null,
      startedAtMs:
        typeof parsed.start === 'number' && Number.isFinite(parsed.start) ? parsed.start : null
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
