import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import type { Readable } from 'node:stream'

/** Why: stdin is 'ignore', so this is narrower than ChildProcessWithoutNullStreams. */
export type LogStreamChild = ChildProcessByStdio<null, Readable, Readable>

/**
 * Counts the macOS TCC consent dialogs that name Orca as the responsible
 * process (#9756). Terminal children — agent CLIs and anything else the user
 * runs — perform the access, but TCC walks the responsibility chain back to
 * Orca and puts Orca's name on the dialog, so users read it as Orca snooping.
 *
 * tccd emits one `AUTHREQ_PROMPTING` line per dialog it actually displays,
 * carrying the service and both identities, so this never has to correlate
 * across lines or guess whether a dialog was shown. Routine preflight checks
 * (the overwhelming majority of TCC log traffic) do not emit it.
 */

/** Why: prod, dev-wrapper, and local-package builds are separate TCC identities that all mean "Orca". */
const ORCA_RESPONSIBLE_IDENTIFIERS = new Set([
  'com.stablyai.orca',
  'com.stablyai.orca.dev',
  'com.stablyai.orca.local'
])

/** Why: the prompt classes #9756 is about — other-apps' data plus the protected home folders agents sweep. */
const WATCHED_SERVICES = new Set([
  'kTCCServiceSystemPolicyAppData',
  'kTCCServiceSystemPolicyAllFiles',
  'kTCCServiceSystemPolicyDocumentsFolder',
  'kTCCServiceSystemPolicyDesktopFolder',
  'kTCCServiceSystemPolicyDownloadsFolder'
])

const LOG_PREDICATE = 'subsystem == "com.apple.TCC" AND eventMessage CONTAINS "AUTHREQ_PROMPTING"'

export type TccPromptEvent = {
  /** TCC service the dialog was raised for, e.g. `kTCCServiceSystemPolicyAppData`. */
  service: string
  /** Bundle id or hashed identity of the process performing the access (often an agent CLI). */
  accessingIdentifier: string
  /** Bundle id macOS holds responsible, and therefore names in the dialog. */
  responsibleIdentifier: string
  /** Absolute path of the accessing binary, when tccd reports one. */
  binaryPath?: string
}

/**
 * Parses one `AUTHREQ_PROMPTING` log line. Returns null for anything else, so
 * callers can feed the raw stream (which includes a header line) straight in.
 */
export function parseTccPromptEvent(line: string): TccPromptEvent | null {
  if (!line.includes('AUTHREQ_PROMPTING')) {
    return null
  }
  const service = /\bservice=(kTCCService\w+)/.exec(line)?.[1]
  const accessingIdentifier = /\bSub:\{([^}]*)\}/.exec(line)?.[1]
  const responsibleIdentifier = /\bResp:\{TCCDProcess:\s*identifier=([^,}]+)/.exec(line)?.[1]
  if (!service || !accessingIdentifier || !responsibleIdentifier) {
    return null
  }
  const binaryPath = /\bbinary_path=([^,}]+)/.exec(line)?.[1]
  return {
    service,
    accessingIdentifier: accessingIdentifier.trim(),
    responsibleIdentifier: responsibleIdentifier.trim(),
    ...(binaryPath ? { binaryPath: binaryPath.trim() } : {})
  }
}

/** True when this dialog is one macOS raised in Orca's name for a watched file-access service. */
export function isOrcaAttributedPrompt(event: TccPromptEvent): boolean {
  return (
    ORCA_RESPONSIBLE_IDENTIFIERS.has(event.responsibleIdentifier) &&
    WATCHED_SERVICES.has(event.service)
  )
}

export type TccPromptWatchOptions = {
  onPrompt: (event: TccPromptEvent) => void
  /** Injected in tests; defaults to spawning `log stream`. */
  spawnLogStream?: () => LogStreamChild
}

function spawnDefaultLogStream(): LogStreamChild {
  // Why: the predicate is evaluated inside the logging system, so this delivers
  // ~1 line per real dialog instead of the ~30/s the TCC subsystem emits raw.
  return spawn(
    '/usr/bin/log',
    ['stream', '--predicate', LOG_PREDICATE, '--info', '--style', 'compact'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
}

/**
 * Watches for Orca-attributed TCC dialogs. macOS-only; `start()` is a no-op
 * elsewhere so callers don't need their own platform guard.
 */
export class MacosTccPromptWatch {
  private child: LogStreamChild | null = null
  private reader: Interface | null = null
  private stopped = false

  constructor(private readonly options: TccPromptWatchOptions) {}

  start(): void {
    if (process.platform !== 'darwin' || this.child || this.stopped) {
      return
    }
    const spawnLogStream = this.options.spawnLogStream ?? spawnDefaultLogStream
    let child: LogStreamChild
    try {
      child = spawnLogStream()
    } catch {
      // Why: diagnostics only — a missing or restricted `log` binary must never
      // break startup, and there is nothing actionable to tell the user.
      return
    }
    this.child = child
    child.on('error', () => this.stop())
    child.on('exit', () => {
      this.reader?.close()
      this.reader = null
      this.child = null
    })
    this.reader = createInterface({ input: child.stdout })
    this.reader.on('line', (line) => this.handleLine(line))
  }

  private handleLine(line: string): void {
    const event = parseTccPromptEvent(line)
    if (!event || !isOrcaAttributedPrompt(event)) {
      return
    }
    this.options.onPrompt(event)
  }

  stop(): void {
    this.stopped = true
    this.reader?.close()
    this.reader = null
    // Why: log stream ignores a closed stdout, so the child needs an explicit kill or it outlives quit.
    this.child?.kill('SIGTERM')
    this.child = null
  }
}
