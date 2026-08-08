import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  encodeLegacyRelayPublicEndpointFence,
  type LegacyRelayPublicEndpointFenceIdentity
} from './legacy-relay-public-endpoint-fence'

const execFileAsync = promisify(execFile)
const PUBLIC_FENCE_MARKER_NAME = '.orca-terminal-authority-fence-v1'

export type WindowsCutoverFileSnapshot = Readonly<{ content: string }> | null

export async function queryWindowsProcessCreationMarker(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null
  }
  const script =
    `$ErrorActionPreference='Stop';` +
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}";` +
    `if(!$p -or !$p.CreationDate){exit 3};` +
    `[Console]::Out.Write(([DateTimeOffset]$p.CreationDate).ToUniversalTime().Ticks)`
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 3_000 }
    )
    return /^\d+$/.test(stdout.trim()) ? stdout.trim() : null
  } catch {
    return null
  }
}

export async function readWindowsCutoverFileSnapshot(
  path: string
): Promise<WindowsCutoverFileSnapshot> {
  try {
    const stats = await lstat(path)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('legacy relay Windows cutover file is not regular')
    }
    return Object.freeze({ content: await readFile(path, 'utf8') })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return null
    }
    throw error
  }
}

export async function ensureWindowsPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('legacy relay Windows authority state is not a directory')
  }
  await sealWindowsPrivateFile(path)
}

export async function sealWindowsPrivateFile(path: string): Promise<void> {
  const user = process.env.USERNAME
  if (!user) {
    throw new Error('legacy relay Windows authority account is unavailable')
  }
  await execFileAsync('icacls.exe', [path, '/inheritance:r', '/grant:r', `${user}:(R,W)`], {
    encoding: 'utf8',
    timeout: 3_000
  })
}

export async function inspectWindowsLegacyRelayPublicFence(
  path: string,
  identity: LegacyRelayPublicEndpointFenceIdentity
): Promise<boolean> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
  if (!stats.isDirectory()) {
    return false
  }
  if (stats.isSymbolicLink()) {
    throw new Error('legacy relay Windows public fence is a symlink')
  }
  const markerPath = join(path, PUBLIC_FENCE_MARKER_NAME)
  let markerStats
  try {
    markerStats = await lstat(markerPath)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      throw new Error('legacy relay Windows public fence is unowned')
    }
    throw error
  }
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
    throw new Error('legacy relay Windows public fence marker is invalid')
  }
  if ((await readFile(markerPath, 'utf8')) !== encodeLegacyRelayPublicEndpointFence(identity)) {
    throw new Error('legacy relay Windows public fence identity changed')
  }
  return true
}

export async function installWindowsLegacyRelayPublicFence(
  path: string,
  identity: LegacyRelayPublicEndpointFenceIdentity
): Promise<void> {
  if (await inspectWindowsLegacyRelayPublicFence(path, identity)) {
    return
  }
  await assertMissing(path)
  const temporary = await mkdtemp(join(dirname(path), `.${basename(path)}.authority-fence-`))
  const markerPath = join(temporary, PUBLIC_FENCE_MARKER_NAME)
  let published = false
  try {
    const marker = await open(markerPath, 'wx')
    try {
      await marker.writeFile(encodeLegacyRelayPublicEndpointFence(identity), 'utf8')
      await marker.sync()
    } finally {
      await marker.close()
    }
    await rename(temporary, path)
    published = true
    await sealWindowsPrivateFile(join(path, PUBLIC_FENCE_MARKER_NAME))
    await sealWindowsPrivateFile(path)
  } catch (error) {
    await (published
      ? removeWindowsLegacyRelayPublicFence(path, identity)
      : rm(temporary, { recursive: true, force: true }))
    throw error
  }
}

export async function removeWindowsLegacyRelayPublicFence(
  path: string,
  identity: LegacyRelayPublicEndpointFenceIdentity
): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
  if (!(await inspectWindowsLegacyRelayPublicFence(path, identity))) {
    throw new Error('legacy relay Windows rollback found a non-fence public path')
  }
  await rm(path, { recursive: true })
}

async function assertMissing(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
  throw new Error('legacy relay Windows public fence target is occupied')
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
