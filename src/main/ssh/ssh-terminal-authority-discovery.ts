import type { SshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import { parseSshTerminalAuthorityMarker } from '../../shared/ssh-terminal-authority-marker'
import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { execCommand } from './ssh-relay-deploy-helpers'
import {
  TERMINAL_AUTHORITY_ACTIVE_ENDPOINT_MARKER_NAME,
  TERMINAL_AUTHORITY_DIRECTORY_NAME,
  type SshTerminalAuthorityEndpoint
} from './ssh-terminal-authority-endpoint'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeWindowsRemotePath,
  remoteBasename,
  remoteDirname,
  type RemoteHostPlatform
} from './ssh-remote-platform'
import { powerShellCommand, powerShellLiteral } from './ssh-remote-powershell'
import { RELAY_REMOTE_DIR } from './relay-protocol'

export const SSH_TERMINAL_AUTHORITY_MARKER_MAX_BYTES = 16 * 1024

const MARKER_ABSENT = 'ORCA_TERMINAL_AUTHORITY_MARKER_ABSENT'
const MARKER_PRESENT = 'ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT'
const MARKER_PRESENT_BASE64 = 'ORCA_TERMINAL_AUTHORITY_MARKER_PRESENT_BASE64'
const MARKER_INVALID = 'ORCA_TERMINAL_AUTHORITY_MARKER_INVALID'
const MARKER_INCONCLUSIVE = 'ORCA_TERMINAL_AUTHORITY_MARKER_INCONCLUSIVE'
const OWNER_ALIVE = 'OWNER_ALIVE'
const OWNER_GONE = 'OWNER_GONE'
const OWNER_UNKNOWN = 'OWNER_UNKNOWN'
const BOOTSTRAP_HOME = 'ORCA_TERMINAL_AUTHORITY_HOME'
const RELAY_VERSION_DIR_PATTERN = /^relay-v?\d+\.\d+\.\d+(?:\+[0-9a-f]+)?$/

export type SshTerminalAuthorityDiscovery =
  | { status: 'absent' }
  | { status: 'available'; marker: SshTerminalAuthorityMarker }
  | { status: 'invalid' | 'inconclusive' }

export type SshTerminalAuthorityOwnerProof = 'owner-alive' | 'owner-gone' | 'inspection-failed'

function posixMarkerReadScript(pathAssignment: string): string {
  return (
    `${pathAssignment}; ` +
    `if [ ! -e "$p" ]; then printf '${MARKER_ABSENT}\\n'; ` +
    `elif [ ! -f "$p" ]; then printf '${MARKER_INVALID}\\n'; ` +
    `else size=$(wc -c < "$p" 2>/dev/null) || { printf '${MARKER_INCONCLUSIVE}\\n'; exit 0; }; ` +
    `if [ "$size" -gt ${SSH_TERMINAL_AUTHORITY_MARKER_MAX_BYTES} ]; then printf '${MARKER_INVALID}\\n'; ` +
    `else printf '${MARKER_PRESENT}\\n'; cat "$p" 2>/dev/null || printf '\\n${MARKER_INCONCLUSIVE}\\n'; ` +
    'fi; fi'
  )
}

function powerShellMarkerReadScript(pathAssignment: string): string {
  return [
    pathAssignment,
    'try {',
    `if (-not (Test-Path -LiteralPath $path)) { '${MARKER_ABSENT}' }`,
    `elseif (-not (Test-Path -LiteralPath $path -PathType Leaf)) { '${MARKER_INVALID}' }`,
    'else {',
    '$item = Get-Item -LiteralPath $path -ErrorAction Stop',
    `if ($item.Length -gt ${SSH_TERMINAL_AUTHORITY_MARKER_MAX_BYTES}) { '${MARKER_INVALID}' }`,
    `else { '${MARKER_PRESENT_BASE64}'; [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) }`,
    '}',
    `} catch { '${MARKER_INCONCLUSIVE}' }`
  ].join('; ')
}

export function sshTerminalAuthorityMarkerReadCommand(
  host: RemoteHostPlatform,
  markerPath: string
): string {
  if (!isWindowsRemoteHost(host)) {
    return posixMarkerReadScript(`p=${shellEscape(markerPath)}`)
  }
  return powerShellCommand(powerShellMarkerReadScript(`$path = ${powerShellLiteral(markerPath)}`))
}

export function sshTerminalAuthorityBootstrapReadCommand(host: RemoteHostPlatform): string {
  if (!isWindowsRemoteHost(host)) {
    const suffix = `${RELAY_REMOTE_DIR}/${TERMINAL_AUTHORITY_DIRECTORY_NAME}/${TERMINAL_AUTHORITY_ACTIVE_ENDPOINT_MARKER_NAME}`
    return `home="\${HOME-}"; printf '${BOOTSTRAP_HOME}\\n%s\\n' "$home"; ${posixMarkerReadScript(`p="$home/${suffix}"`)}`
  }
  return powerShellCommand(
    [
      `$home = [Environment]::GetFolderPath('UserProfile')`,
      `'${BOOTSTRAP_HOME}'`,
      '$home',
      powerShellMarkerReadScript(
        `$path = [IO.Path]::Combine($home, ${powerShellLiteral(RELAY_REMOTE_DIR)}, ${powerShellLiteral(TERMINAL_AUTHORITY_DIRECTORY_NAME)}, ${powerShellLiteral(TERMINAL_AUTHORITY_ACTIVE_ENDPOINT_MARKER_NAME)})`
      )
    ].join('; ')
  )
}

export function parseSshTerminalAuthorityBootstrapRead(
  output: string
): { rawRemoteHome: string; discovery: SshTerminalAuthorityDiscovery } | null {
  const normalized = output.replace(/\r\n/g, '\n')
  const firstBreak = normalized.indexOf('\n')
  const secondBreak = normalized.indexOf('\n', firstBreak + 1)
  if (
    firstBreak === -1 ||
    secondBreak === -1 ||
    normalized.slice(0, firstBreak).trim() !== BOOTSTRAP_HOME
  ) {
    return null
  }
  return {
    rawRemoteHome: normalized.slice(firstBreak + 1, secondBreak),
    discovery: parseSshTerminalAuthorityDiscovery(normalized.slice(secondBreak + 1))
  }
}

export function parseSshTerminalAuthorityDiscovery(output: string): SshTerminalAuthorityDiscovery {
  const normalized = output.replace(/\r\n/g, '\n')
  const separator = normalized.indexOf('\n')
  const status = (separator === -1 ? normalized : normalized.slice(0, separator)).trim()
  const payload = separator === -1 ? '' : normalized.slice(separator + 1).trim()
  if (status === MARKER_ABSENT) {
    return { status: 'absent' }
  }
  if (status === MARKER_INVALID) {
    return { status: 'invalid' }
  }
  if (status === MARKER_INCONCLUSIVE) {
    return { status: 'inconclusive' }
  }
  let markerJson = payload
  if (status === MARKER_PRESENT_BASE64) {
    try {
      markerJson = Buffer.from(payload, 'base64').toString('utf8')
    } catch {
      return { status: 'invalid' }
    }
  } else if (status !== MARKER_PRESENT) {
    return { status: 'inconclusive' }
  }
  try {
    const marker = parseSshTerminalAuthorityMarker(JSON.parse(markerJson))
    return marker ? { status: 'available', marker } : { status: 'invalid' }
  } catch {
    return { status: 'invalid' }
  }
}

export async function discoverSshTerminalAuthority(
  conn: SshConnection,
  host: RemoteHostPlatform,
  markerPath: string,
  options?: { signal?: AbortSignal }
): Promise<SshTerminalAuthorityDiscovery> {
  try {
    const output = await execCommand(
      conn,
      sshTerminalAuthorityMarkerReadCommand(host, markerPath),
      {
        wrapCommand: !isWindowsRemoteHost(host),
        signal: options?.signal
      }
    )
    return parseSshTerminalAuthorityDiscovery(output)
  } catch {
    options?.signal?.throwIfAborted()
    return { status: 'inconclusive' }
  }
}

function normalizedRemotePath(host: RemoteHostPlatform, value: string): string {
  const normalized =
    host.pathFlavor === 'windows' ? normalizeWindowsRemotePath(value).toLowerCase() : value
  return normalized.replace(/\/+$/, '')
}

export function sshTerminalAuthorityMarkerHasExpectedPaths(
  marker: SshTerminalAuthorityMarker,
  host: RemoteHostPlatform,
  remoteHome: string,
  endpoint: SshTerminalAuthorityEndpoint
): boolean {
  const expectedRelayBase = normalizedRemotePath(
    host,
    joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR)
  )
  const ownerRelayDir = normalizedRemotePath(host, marker.ownerRelayDir)
  return (
    normalizedRemotePath(host, remoteDirname(ownerRelayDir, host)) === expectedRelayBase &&
    RELAY_VERSION_DIR_PATTERN.test(remoteBasename(ownerRelayDir, host)) &&
    normalizedRemotePath(host, marker.socketPath) ===
      normalizedRemotePath(host, endpoint.socketPath) &&
    normalizedRemotePath(host, marker.credentialFile) ===
      normalizedRemotePath(host, endpoint.credentialFile)
  )
}

export function sshTerminalAuthorityOwnerProofCommand(
  host: RemoteHostPlatform,
  marker: Pick<SshTerminalAuthorityMarker, 'ownerPid' | 'ownerProcessToken'>
): string {
  if (isWindowsRemoteHost(host)) {
    const token = powerShellLiteral(marker.ownerProcessToken)
    const filter = powerShellLiteral(`ProcessId = ${marker.ownerPid}`)
    const inspectOwner = [
      '$owner = $owners[0]',
      `if ([string]::IsNullOrWhiteSpace([string]$owner.CommandLine)) { '${OWNER_UNKNOWN}' }`,
      `elseif ($owner.CommandLine -match ('(?:^|\\s)--authority-process-token\\s+["'']?' + [Regex]::Escape(${token}) + '["'']?(?:\\s|$)')) { '${OWNER_ALIVE}' }`,
      `else { '${OWNER_GONE}' }`
    ].join('; ')
    return powerShellCommand(
      `try { $owners = @(Get-CimInstance Win32_Process -Filter ${filter} -ErrorAction Stop); ` +
        `if ($owners.Count -eq 0) { '${OWNER_GONE}' } ` +
        `elseif ($owners.Count -ne 1) { '${OWNER_UNKNOWN}' } ` +
        `else { ${inspectOwner} } } catch { '${OWNER_UNKNOWN}' }`
    )
  }
  const pid = marker.ownerPid
  const token = shellEscape(marker.ownerProcessToken)
  if (host.os === 'linux') {
    return [
      `pid=${pid}`,
      `token=${token}`,
      `if [ ! -d "/proc/$pid" ]; then printf '${OWNER_GONE}\\n'`,
      `elif [ ! -r "/proc/$pid/cmdline" ]; then printf '${OWNER_UNKNOWN}\\n'`,
      `elif tr '\\000' '\\n' < "/proc/$pid/cmdline" | awk -v token="$token" 'previous=="--authority-process-token" && $0==token { found=1 } { previous=$0 } END { exit found ? 0 : 1 }'`,
      `then printf '${OWNER_ALIVE}\\n'; else printf '${OWNER_GONE}\\n'; fi`
    ].join('; ')
  }

  const classifyProcessTable = [
    'function emit(value) { print value; emitted=1; exit }',
    '/^[[:space:]]*[0-9]+([[:space:]]|$)/ {',
    'row=$0; sub(/^[[:space:]]*/, "", row); candidate=row;',
    'sub(/[[:space:]].*$/, "", candidate);',
    'if (candidate !~ /^[0-9]+$/) next;',
    'valid=1; if (candidate != target) next;',
    'sub(/^[0-9]+[[:space:]]*/, "", row);',
    `if (length(row) == 0) emit("${OWNER_UNKNOWN}");`,
    'padded=" " row " "; needle=" --authority-process-token " token " ";',
    `emit(index(padded, needle) ? "${OWNER_ALIVE}" : "${OWNER_GONE}")`,
    '}',
    `END { if (!emitted) print valid ? "${OWNER_GONE}" : "${OWNER_UNKNOWN}" }`
  ].join(' ')
  return [
    `pid=${pid}`,
    `token=${token}`,
    `table=$(command ps -ww -ax -o pid= -o command= 2>/dev/null) || { printf '${OWNER_UNKNOWN}\\n'; exit 0; }`,
    `if [ -z "$table" ]; then printf '${OWNER_UNKNOWN}\\n'`,
    `else proof=$(printf '%s\\n' "$table" | awk -v target="$pid" -v token="$token" ${shellEscape(classifyProcessTable)}) || { printf '${OWNER_UNKNOWN}\\n'; exit 0; }`,
    `case "$proof" in ${OWNER_ALIVE}|${OWNER_GONE}) printf '%s\\n' "$proof" ;; *) printf '${OWNER_UNKNOWN}\\n' ;; esac; fi`
  ].join('; ')
}

export function parseSshTerminalAuthorityOwnerProof(
  output: string
): SshTerminalAuthorityOwnerProof {
  switch (output.trim()) {
    case OWNER_ALIVE:
      return 'owner-alive'
    case OWNER_GONE:
      return 'owner-gone'
    case OWNER_UNKNOWN:
      return 'inspection-failed'
    default:
      return 'inspection-failed'
  }
}

export async function proveSshTerminalAuthorityOwner(
  conn: SshConnection,
  host: RemoteHostPlatform,
  marker: Pick<SshTerminalAuthorityMarker, 'ownerPid' | 'ownerProcessToken'>,
  options?: { signal?: AbortSignal }
): Promise<SshTerminalAuthorityOwnerProof> {
  try {
    const output = await execCommand(conn, sshTerminalAuthorityOwnerProofCommand(host, marker), {
      wrapCommand: !isWindowsRemoteHost(host),
      signal: options?.signal
    })
    return parseSshTerminalAuthorityOwnerProof(output)
  } catch {
    options?.signal?.throwIfAborted()
    return 'inspection-failed'
  }
}
