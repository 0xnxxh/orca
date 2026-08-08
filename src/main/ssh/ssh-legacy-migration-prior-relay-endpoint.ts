import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import type { TerminalLegacyEndpointIdentity } from '../../shared/terminal-legacy-cutover'
import { isRecord } from '../../shared/terminal-session-authority-identity'
import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { sshLegacyPriorRelayWindowsEndpoint } from './ssh-legacy-migration-prior-relay-status'
import { execCommand } from './ssh-relay-exec-command'
import { isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellCommand, powerShellNativeArg } from './ssh-remote-powershell'

const SENTINEL = 'ORCA_LEGACY_PRIOR_RELAY'
const READ_TIMEOUT_MS = 10_000
const MAX_RESPONSE_CHARS = 4_096

/**
 * One bounded read-only observation of the recorded prior relay. It never mutates the legacy
 * endpoint and its failure modes are all `unknown`, so no branch here can authorize a cutover.
 */
export type SshLegacyPriorRelayEndpoint =
  | Readonly<{ kind: 'observed'; endpoint: TerminalLegacyEndpointIdentity }>
  | Readonly<{ kind: 'unknown'; reason: string }>

export type SshLegacyPriorRelayEndpointInput = Readonly<{
  connection: SshConnection
  hostPlatform: RemoteHostPlatform
  nodePath: string
  marker: SshTerminalAuthorityMarker
  signal: AbortSignal
}>

export async function readSshLegacyPriorRelayEndpoint(
  input: SshLegacyPriorRelayEndpointInput
): Promise<SshLegacyPriorRelayEndpoint> {
  if (input.signal.aborted) {
    return unknownEndpoint('prior relay observation was aborted')
  }
  let output: string
  try {
    output = await execCommand(input.connection, observationCommand(input), {
      wrapCommand: !isWindowsRemoteHost(input.hostPlatform),
      timeoutMs: READ_TIMEOUT_MS,
      signal: input.signal
    })
  } catch (error) {
    return unknownEndpoint(
      `prior relay observation failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (input.signal.aborted) {
    return unknownEndpoint('prior relay observation was aborted')
  }
  return parseObservation(output, input)
}

function observationCommand(input: SshLegacyPriorRelayEndpointInput): string {
  const encoded = Buffer.from(observationScript(), 'utf8').toString('base64')
  const evaluate = `eval(Buffer.from('${encoded}','base64').toString('utf8'))`
  const pid = String(input.marker.ownerPid)
  if (!isWindowsRemoteHost(input.hostPlatform)) {
    return `${shellEscape(input.nodePath)} -e ${shellEscape(evaluate)} ${shellEscape(input.marker.socketPath)} ${shellEscape(pid)}`
  }
  return powerShellCommand(
    [
      `& ${powerShellNativeArg(input.nodePath)}`,
      '-e',
      powerShellNativeArg(evaluate),
      powerShellNativeArg(input.marker.socketPath),
      powerShellNativeArg(pid)
    ].join(' ')
  )
}

// Why remote node and not `stat`: the owning host compares against `fs.lstat` device/inode/ctimeNs,
// and no portable shell reports ctime nanoseconds identically on Linux and macOS.
function observationScript(): string {
  return [
    'const fs=require("fs");',
    'const a=process.argv.slice(1);',
    'let r={endpoint:null,liveness:"unknown"};',
    'try{const s=fs.lstatSync(a[0],{bigint:true});',
    'if(s.isSocket()){r.endpoint={device:s.dev.toString(),inode:s.ino.toString(),changedAtNs:s.ctimeNs.toString()}}',
    '}catch(e){r.endpoint=null}',
    'try{process.kill(Number(a[1]),0);r.liveness="alive"}',
    'catch(e){r.liveness=e&&e.code==="EPERM"?"alive":"gone"}',
    `process.stdout.write("${SENTINEL} "+JSON.stringify(r))`
  ].join('')
}

function parseObservation(
  output: string,
  input: SshLegacyPriorRelayEndpointInput
): SshLegacyPriorRelayEndpoint {
  const marker = output.lastIndexOf(SENTINEL)
  if (marker === -1) {
    return unknownEndpoint('prior relay observation produced no response')
  }
  const payload = output.slice(marker + SENTINEL.length).trim()
  if (payload.length === 0 || payload.length > MAX_RESPONSE_CHARS) {
    return unknownEndpoint('prior relay observation response is not bounded')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return unknownEndpoint('prior relay observation response is malformed')
  }
  if (!isRecord(parsed) || parsed.liveness !== 'alive') {
    return unknownEndpoint('prior relay process is not observably alive')
  }
  return isWindowsRemoteHost(input.hostPlatform)
    ? Object.freeze({
        kind: 'observed',
        endpoint: sshLegacyPriorRelayWindowsEndpoint(input.marker)
      })
    : posixEndpoint(parsed.endpoint)
}

function posixEndpoint(value: unknown): SshLegacyPriorRelayEndpoint {
  if (
    !isRecord(value) ||
    !boundedDigits(value.device) ||
    !boundedDigits(value.inode) ||
    !boundedDigits(value.changedAtNs)
  ) {
    return unknownEndpoint('prior relay endpoint identity is not observable')
  }
  return Object.freeze({
    kind: 'observed',
    endpoint: Object.freeze({
      kind: 'unix-socket',
      device: value.device,
      inode: value.inode,
      changedAtNs: value.changedAtNs
    })
  })
}

function boundedDigits(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && /^\d+$/.test(value)
}

function unknownEndpoint(reason: string): SshLegacyPriorRelayEndpoint {
  return Object.freeze({ kind: 'unknown', reason })
}
