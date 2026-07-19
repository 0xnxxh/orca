import { execFile, execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { promisify } from 'node:util'
import { macPathsEqual, type MacUpdateInstallFence } from '../shared/mac-update-install-fence'

const execFileAsync = promisify(execFile)
const PROCESS_LIST_ARGS = ['-ww', '-axo', 'pid=,command='] as const
const MONITOR_MARKER = '--orca-update-fence-monitor'
const INTERNAL_NODE_ENTRY_SUFFIXES = [
  '/daemon-entry.js',
  '/parcel-watcher-process-entry.js',
  '/computer-sidecar.js',
  '/stt-worker.js',
  '/warp-theme-parser-worker.js',
  '/mac-update-install-fence-monitor.js'
] as const

export type MacProductionProcessBlocker = {
  pid: number
  mode: 'gui' | 'serve' | 'unknown'
}

export type MacProcessRecord = {
  pid: number
  command: string
}

export async function findMacProductionProcessBlocker(options: {
  executablePath: string
  excludedPids: ReadonlySet<number>
}): Promise<MacProductionProcessBlocker | null> {
  const records = await readMacProcessTable()
  return classifyProductionBlocker(records, options)
}

export async function isMatchingShipItProcessAlive(fence: MacUpdateInstallFence): Promise<boolean> {
  return hasMatchingShipIt(await readMacProcessTable(), fence)
}

export function isMatchingShipItProcessAliveSync(fence: MacUpdateInstallFence): boolean {
  try {
    return hasMatchingShipIt(readMacProcessTableSync(), fence)
  } catch {
    return false
  }
}

export function isFenceMonitorIdentityAliveSync(fence: MacUpdateInstallFence): boolean {
  try {
    return hasFenceMonitorIdentity(readMacProcessTableSync(), fence)
  } catch {
    return false
  }
}

export function hasMatchingShipItProcess(
  records: readonly MacProcessRecord[],
  fence: MacUpdateInstallFence
): boolean {
  return hasMatchingShipIt(records, fence)
}

export function hasFenceMonitorIdentity(
  records: readonly MacProcessRecord[],
  fence: MacUpdateInstallFence
): boolean {
  const record = records.find(({ pid }) => pid === fence.monitorPid)
  return record ? commandHasMonitorIdentity(record.command, fence.attemptId) : false
}

export function hasSourceApplicationProcess(
  records: readonly MacProcessRecord[],
  fence: MacUpdateInstallFence,
  bundleMacOsDirectory: string
): boolean {
  const record = records.find(({ pid }) => pid === fence.sourcePid)
  if (!record) {
    return false
  }
  // Why: pid reuse must not read as a live source app; require the process's
  // argv0 to live inside the source bundle without pinning the binary's name.
  const prefix = bundleMacOsDirectory.endsWith('/')
    ? bundleMacOsDirectory
    : `${bundleMacOsDirectory}/`
  return [prefix, `"${prefix}`, `'${prefix}`].some((candidate) =>
    record.command.startsWith(candidate)
  )
}

export async function isSourceApplicationProcessAlive(
  fence: MacUpdateInstallFence,
  bundleMacOsDirectory: string
): Promise<boolean> {
  return hasSourceApplicationProcess(await readMacProcessTable(), fence, bundleMacOsDirectory)
}

export function getMacUpdateFenceMonitorMarker(): string {
  return MONITOR_MARKER
}

// Why 1s: covers filesystem mtime granularity only. A wider slack would let a
// rapid retry misread the PREVIOUS attempt's leftover plist as evidence for
// this one (it swaps the monitor's 15s abort window for the 90s one).
const SHIPIT_STATE_MTIME_SLACK_MS = 1_000

/** ShipItState.plist written at/after this attempt started. Weaker evidence
 * than a live ShipIt process (an aborted install leaves the file behind), so
 * callers must bound how long they trust it. */
export function hasCurrentShipItStateEvidence(fence: MacUpdateInstallFence): boolean {
  try {
    return statSync(fence.shipItStatePath).mtimeMs >= fence.createdAt - SHIPIT_STATE_MTIME_SLACK_MS
  } catch {
    return false
  }
}

export async function readMacProcessTable(): Promise<MacProcessRecord[]> {
  if (process.platform !== 'darwin') {
    return []
  }
  // Why: a hung ps would otherwise wedge the monitor loop and the pre-commit
  // quiescence wait indefinitely; keep the same bound as the sync variant.
  const { stdout } = await execFileAsync('/bin/ps', [...PROCESS_LIST_ARGS], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 2_000
  })
  return parseProcessTable(stdout)
}

export function readMacProcessTableSync(): MacProcessRecord[] {
  if (process.platform !== 'darwin') {
    return []
  }
  const stdout = execFileSync('/bin/ps', [...PROCESS_LIST_ARGS], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 2_000
  })
  return parseProcessTable(stdout)
}

export function parseMacProcessTableForTest(stdout: string): MacProcessRecord[] {
  return parseProcessTable(stdout)
}

export function classifyMacProductionBlockerForTest(
  records: MacProcessRecord[],
  options: { executablePath: string; excludedPids: ReadonlySet<number> }
): MacProductionProcessBlocker | null {
  return classifyProductionBlocker(records, options)
}

export function commandMatchesShipItForTest(
  command: string,
  fence: MacUpdateInstallFence
): boolean {
  return commandMatchesShipIt(command, fence)
}

function parseProcessTable(stdout: string): MacProcessRecord[] {
  const records: MacProcessRecord[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!match) {
      continue
    }
    const pid = Number(match[1])
    if (Number.isSafeInteger(pid) && pid > 0) {
      records.push({ pid, command: match[2].trim() })
    }
  }
  return records
}

function classifyProductionBlocker(
  records: MacProcessRecord[],
  options: { executablePath: string; excludedPids: ReadonlySet<number> }
): MacProductionProcessBlocker | null {
  for (const record of records) {
    if (options.excludedPids.has(record.pid)) {
      continue
    }
    const argumentsText = getExecutableArguments(record.command, options.executablePath)
    if (argumentsText === null) {
      continue
    }
    const args = tokenizeProcessArguments(argumentsText)
    if (isKnownInternalNodeInvocation(args) || isPackagedCliInvocation(args)) {
      continue
    }
    if (args.every((argument) => argument.startsWith('-psn_'))) {
      return { pid: record.pid, mode: 'gui' }
    }
    if (args.includes('--serve')) {
      return { pid: record.pid, mode: 'serve' }
    }
    return { pid: record.pid, mode: 'unknown' }
  }
  return null
}

function hasMatchingShipIt(
  records: readonly MacProcessRecord[],
  fence: MacUpdateInstallFence
): boolean {
  return records.some(({ command }) => commandMatchesShipIt(command, fence))
}

function commandMatchesShipIt(command: string, fence: MacUpdateInstallFence): boolean {
  const args = tokenizeProcessArguments(command)
  const executable = args[0]
  if (executable?.endsWith('/Squirrel.framework/Resources/ShipIt')) {
    return (
      args.includes(`${fence.bundleIdentifier}.ShipIt`) &&
      args.some((argument) => macPathsEqual(argument, fence.shipItStatePath))
    )
  }
  // Why: ps does not quote argv, so a bundle path containing spaces breaks
  // tokenization. Fall back to raw substring evidence; over-matching only
  // extends blocking, which stays bounded by the fence lifetime.
  return (
    command.includes('/Squirrel.framework/Resources/ShipIt') &&
    command.includes(`${fence.bundleIdentifier}.ShipIt`) &&
    command.includes(fence.shipItStatePath)
  )
}

function commandHasMonitorIdentity(command: string, attemptId: string): boolean {
  const args = tokenizeProcessArguments(command)
  const markerIndex = args.indexOf(MONITOR_MARKER)
  return markerIndex >= 0 && args[markerIndex + 1] === attemptId
}

function getExecutableArguments(command: string, executablePath: string): string | null {
  for (const prefix of [executablePath, `"${executablePath}"`, `'${executablePath}'`]) {
    if (command === prefix) {
      return ''
    }
    if (command.startsWith(`${prefix} `)) {
      return command.slice(prefix.length + 1)
    }
  }
  return null
}

function isKnownInternalNodeInvocation(args: string[]): boolean {
  if (args.includes(MONITOR_MARKER)) {
    return true
  }
  return args.some((argument) =>
    INTERNAL_NODE_ENTRY_SUFFIXES.some((suffix) => argument.endsWith(suffix))
  )
}

function isPackagedCliInvocation(args: string[]): boolean {
  return args.some(
    (argument) => argument.endsWith('/out/cli/index.js') || argument.endsWith('/out/cli/index.cjs')
  )
}

function tokenizeProcessArguments(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const pushToken = (): void => {
    if (token.length > 0) {
      tokens.push(token)
      token = ''
    }
  }
  for (const character of command) {
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        token += character
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/.test(character)) {
      pushToken()
    } else {
      token += character
    }
  }
  if (escaped) {
    token += '\\'
  }
  pushToken()
  return tokens
}
