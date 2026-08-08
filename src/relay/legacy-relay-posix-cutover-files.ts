import { chmod, lstat, mkdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  inspectPosixLegacyRelayPublicFence,
  type LegacyRelayPublicEndpointFenceIdentity
} from './legacy-relay-public-endpoint-fence'

export type PosixLegacyRelayCutoverPaths = Readonly<{
  publicSocketPath: string
  privateSocketPath: string
  publicCredentialFile: string
  privateCredentialFile: string
  privateStateDirectory: string
}>

export function validatePosixLegacyRelayCutoverPaths(
  input: PosixLegacyRelayCutoverPaths
): PosixLegacyRelayCutoverPaths {
  const paths = {
    publicSocketPath: resolveAbsolute(input.publicSocketPath),
    privateSocketPath: resolveAbsolute(input.privateSocketPath),
    publicCredentialFile: resolveAbsolute(input.publicCredentialFile),
    privateCredentialFile: resolveAbsolute(input.privateCredentialFile),
    privateStateDirectory: resolveAbsolute(input.privateStateDirectory)
  }
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length) {
    throw new Error('legacy relay cutover paths must be distinct')
  }
  assertPrivateChild(paths.privateStateDirectory, paths.privateSocketPath)
  assertPrivateChild(paths.privateStateDirectory, paths.privateCredentialFile)
  return Object.freeze(paths)
}

export async function sealPosixLegacyRelayPrivateDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await lstat(path, { bigint: true })
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('legacy relay authority state is not a private directory')
  }
  if (typeof process.getuid === 'function' && stats.uid !== BigInt(process.getuid())) {
    throw new Error('legacy relay authority state has a foreign owner')
  }
  await chmod(path, 0o700)
  return stats.dev.toString()
}

export async function inspectPosixLegacyRelayCredentialPair(
  paths: PosixLegacyRelayCutoverPaths,
  publicFence: LegacyRelayPublicEndpointFenceIdentity,
  directoryDevice: string
): Promise<Readonly<{ location: 'public' | 'private' }>> {
  const fenced = await inspectPosixLegacyRelayPublicFence(paths.publicCredentialFile, publicFence)
  const [publicCredential, privateCredential] = await Promise.all([
    fenced ? null : inspectCredential(paths.publicCredentialFile),
    inspectCredential(paths.privateCredentialFile)
  ])
  if (fenced && !privateCredential) {
    throw new Error('legacy relay public credential fence has no private credential')
  }
  if (Boolean(publicCredential) === Boolean(privateCredential)) {
    throw new Error('legacy relay credential sealing state is ambiguous')
  }
  const credential = publicCredential ?? privateCredential!
  if (credential.device !== directoryDevice) {
    throw new Error('legacy relay credential cannot be atomically sealed across filesystems')
  }
  return Object.freeze({ location: publicCredential ? 'public' : 'private' })
}

export async function sealPosixLegacyRelayCredential(path: string): Promise<void> {
  await chmod(path, 0o600)
}

export async function assertPosixLegacyRelayPathMissing(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
  throw new Error(`legacy relay private target already exists: ${path}`)
}

async function inspectCredential(path: string): Promise<Readonly<{ device: string }> | null> {
  let stats
  try {
    stats = await lstat(path, { bigint: true })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('legacy relay credential is not a regular file')
  }
  const credential = (await readFile(path, 'utf8')).trim()
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential)) {
    throw new Error('legacy relay credential is invalid')
  }
  return Object.freeze({ device: stats.dev.toString() })
}

function resolveAbsolute(value: string): string {
  if (!value.startsWith('/') || value.includes('\0')) {
    throw new Error('legacy relay POSIX cutover path must be absolute')
  }
  return resolve(value)
}

function assertPrivateChild(directory: string, child: string): void {
  const pathFromDirectory = relative(directory, child)
  if (!pathFromDirectory || pathFromDirectory.startsWith('..') || resolve(child) === directory) {
    throw new Error('legacy relay private path escapes authority state')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
