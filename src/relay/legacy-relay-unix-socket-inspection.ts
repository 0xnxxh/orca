import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { TerminalLegacyEndpointIdentity } from '../shared/terminal-legacy-cutover'
import {
  lsofNameReferencesSocket,
  parseLinuxProcNetUnix,
  parseLsofUnixFields
} from './legacy-relay-unix-socket-records'

const execFileAsync = promisify(execFile)
const MAX_PROCESS_FDS = 4_096

type UnixEndpointIdentity = Extract<TerminalLegacyEndpointIdentity, { kind: 'unix-socket' }>

export type LegacyUnixSocketInspection = Readonly<{
  method: 'linux-procfs-unix' | 'darwin-lsof-unix'
  endpointIdentity: UnixEndpointIdentity
  listenerIdentity: string
  acceptedServerConnections: 1
}>

export type LegacyUnixSocketInspectionRequest = Readonly<{
  platform: 'linux' | 'darwin'
  socketPath: string
  relayPid: number
}>

type LegacyUnixSocketInspectionDependencies = Readonly<{
  inspectEndpoint?: (socketPath: string) => Promise<UnixEndpointIdentity>
  readTextFile?: (path: string) => Promise<string>
  listDirectory?: (path: string) => Promise<readonly string[]>
  readLink?: (path: string) => Promise<string>
  runLsof?: (relayPid: number) => Promise<string>
}>

export async function inspectLegacyUnixSocket(
  request: LegacyUnixSocketInspectionRequest,
  dependencies: LegacyUnixSocketInspectionDependencies = {}
): Promise<LegacyUnixSocketInspection> {
  if (!Number.isSafeInteger(request.relayPid) || request.relayPid <= 0) {
    throw new Error('legacy relay pid is invalid')
  }
  if (!request.socketPath.startsWith('/')) {
    throw new Error('legacy relay Unix socket path must be absolute')
  }
  const endpointIdentity = await (dependencies.inspectEndpoint ?? inspectUnixEndpoint)(
    request.socketPath
  )
  return request.platform === 'linux'
    ? await inspectLinuxSocket(request, endpointIdentity, dependencies)
    : await inspectDarwinSocket(request, endpointIdentity, dependencies)
}

export async function inspectUnixEndpoint(socketPath: string): Promise<UnixEndpointIdentity> {
  const stats = await lstat(socketPath, { bigint: true })
  if (!stats.isSocket()) {
    throw new Error('legacy relay endpoint is not a Unix socket')
  }
  return Object.freeze({
    kind: 'unix-socket',
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    changedAtNs: stats.ctimeNs.toString()
  })
}

async function inspectLinuxSocket(
  request: LegacyUnixSocketInspectionRequest,
  endpointIdentity: UnixEndpointIdentity,
  dependencies: LegacyUnixSocketInspectionDependencies
): Promise<LegacyUnixSocketInspection> {
  const readTextFile = dependencies.readTextFile ?? readUtf8
  const records = parseLinuxProcNetUnix(await readTextFile('/proc/net/unix'))
  const listener = records.filter(
    (record) =>
      record.inode === endpointIdentity.inode &&
      record.path === request.socketPath &&
      record.type === '0001' &&
      record.state === '01' &&
      Number.parseInt(record.flags, 16) & 0x1_0000
  )
  if (listener.length !== 1) {
    throw new Error('legacy relay listener identity is not exact in procfs')
  }
  const ownedInodes = await readProcessSocketInodes(request.relayPid, dependencies)
  if (!ownedInodes.has(endpointIdentity.inode)) {
    throw new Error('legacy relay process does not own the listener inode')
  }
  const connected = records.filter(
    (record) => record.type === '0001' && record.state === '03' && ownedInodes.has(record.inode)
  )
  if (connected.length !== 1) {
    throw new Error('legacy relay does not have exactly one accepted Unix client')
  }
  return Object.freeze({
    method: 'linux-procfs-unix',
    endpointIdentity,
    listenerIdentity: `${request.relayPid}:socket:${endpointIdentity.inode}`,
    acceptedServerConnections: 1
  })
}

async function inspectDarwinSocket(
  request: LegacyUnixSocketInspectionRequest,
  endpointIdentity: UnixEndpointIdentity,
  dependencies: LegacyUnixSocketInspectionDependencies
): Promise<LegacyUnixSocketInspection> {
  const output = await (dependencies.runLsof ?? runLsof)(request.relayPid)
  const records = parseLsofUnixFields(output).filter(
    (record) =>
      record.pid === request.relayPid &&
      record.type.toLowerCase() === 'unix' &&
      lsofNameReferencesSocket(record.name, request.socketPath)
  )
  const listeners = records.filter((record) => record.state?.toUpperCase() === 'LISTEN')
  const connected = records.filter((record) => record.state?.toUpperCase() === 'CONNECTED')
  if (listeners.length !== 1) {
    throw new Error('legacy relay listener identity is not exact in lsof')
  }
  if (connected.length !== 1) {
    throw new Error('legacy relay does not have exactly one accepted lsof client')
  }
  return Object.freeze({
    method: 'darwin-lsof-unix',
    endpointIdentity,
    listenerIdentity: `${request.relayPid}:unix:${endpointIdentity.device}:${endpointIdentity.inode}`,
    acceptedServerConnections: 1
  })
}

async function readProcessSocketInodes(
  pid: number,
  dependencies: LegacyUnixSocketInspectionDependencies
): Promise<Set<string>> {
  const directory = `/proc/${pid}/fd`
  const names = await (dependencies.listDirectory ?? listNames)(directory)
  if (names.length > MAX_PROCESS_FDS) {
    throw new Error('legacy relay fd inspection exceeds its bound')
  }
  const readLink = dependencies.readLink ?? readlink
  const targets = await Promise.all(
    names.map(async (name) => {
      try {
        return await readLink(`${directory}/${name}`)
      } catch {
        return ''
      }
    })
  )
  return new Set(
    targets.flatMap((target) => {
      const match = /^socket:\[(\d+)\]$/.exec(target)
      return match ? [match[1]] : []
    })
  )
}

async function runLsof(relayPid: number): Promise<string> {
  const { stdout } = await execFileAsync(
    'lsof',
    ['-nP', '-a', '-U', '-p', String(relayPid), '-F0pftnT'],
    { encoding: 'utf8', timeout: 3_000 }
  )
  return stdout
}

async function readUtf8(path: string): Promise<string> {
  return await readFile(path, 'utf8')
}

async function listNames(path: string): Promise<string[]> {
  return await readdir(path)
}
