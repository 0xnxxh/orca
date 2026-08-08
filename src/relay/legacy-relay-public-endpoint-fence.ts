import { chmod, lstat, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const PUBLIC_FENCE_MARKER_NAME = '.orca-terminal-authority-fence-v1'

export type LegacyRelayLaunchExclusion = Readonly<{
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>
}>

export type LegacyRelayPublicEndpointFenceIdentity = Readonly<{
  role: 'socket' | 'credential' | 'active-pipe-marker'
  endpointIdentity: string
  privatePath: string
}>

export async function runWithLegacyRelayLaunchExclusion<T>(
  exclusion: LegacyRelayLaunchExclusion,
  operation: () => Promise<T>
): Promise<T> {
  let calls = 0
  const result = await exclusion.runExclusive(async () => {
    calls++
    if (calls !== 1) {
      throw new Error('legacy relay launch exclusion invoked cutover more than once')
    }
    return await operation()
  })
  if (calls !== 1) {
    throw new Error('legacy relay launch exclusion did not guard cutover')
  }
  return result
}

export async function inspectPosixLegacyRelayPublicFence(
  path: string,
  identity: LegacyRelayPublicEndpointFenceIdentity
): Promise<boolean> {
  let stats
  try {
    stats = await lstat(path, { bigint: true })
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
    throw new Error('legacy relay public endpoint fence is a symlink')
  }
  assertOwned(stats.uid)
  const markerPath = join(path, PUBLIC_FENCE_MARKER_NAME)
  const markerStats = await lstat(markerPath, { bigint: true }).catch((error) => {
    if (hasCode(error, 'ENOENT')) {
      throw new Error('legacy relay public endpoint fence is unowned')
    }
    throw error
  })
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
    throw new Error('legacy relay public endpoint fence marker is invalid')
  }
  assertOwned(markerStats.uid)
  if ((await readFile(markerPath, 'utf8')) !== encodeLegacyRelayPublicEndpointFence(identity)) {
    throw new Error('legacy relay public endpoint fence identity changed')
  }
  return true
}

export async function installPosixLegacyRelayPublicFence(
  path: string,
  identity: LegacyRelayPublicEndpointFenceIdentity
): Promise<void> {
  if (await inspectPosixLegacyRelayPublicFence(path, identity)) {
    return
  }
  await assertMissing(path)
  const temporary = await mkdtemp(join(dirname(path), `.${basename(path)}.authority-fence-`))
  let published = false
  try {
    await chmod(temporary, 0o700)
    const markerPath = join(temporary, PUBLIC_FENCE_MARKER_NAME)
    const marker = await open(markerPath, 'wx', 0o600)
    try {
      await marker.writeFile(encodeLegacyRelayPublicEndpointFence(identity), 'utf8')
      await marker.sync()
    } finally {
      await marker.close()
    }
    await rename(temporary, path)
    published = true
    await syncDirectory(dirname(path))
  } catch (error) {
    await (published
      ? removePosixLegacyRelayPublicFence(path, identity)
      : rm(temporary, { recursive: true, force: true }))
    throw error
  }
  if (!(await inspectPosixLegacyRelayPublicFence(path, identity))) {
    throw new Error('legacy relay public endpoint fence publication failed')
  }
}

export async function removePosixLegacyRelayPublicFence(
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
  if (!(await inspectPosixLegacyRelayPublicFence(path, identity))) {
    throw new Error('legacy relay rollback found a non-fence public path')
  }
  await rm(path, { recursive: true })
  await syncDirectory(dirname(path))
}

export function encodeLegacyRelayPublicEndpointFence(
  identity: LegacyRelayPublicEndpointFenceIdentity
): string {
  return JSON.stringify({ version: 1, ...identity })
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
  throw new Error('legacy relay public endpoint fence target is occupied')
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

function assertOwned(uid: bigint): void {
  if (typeof process.getuid === 'function' && uid !== BigInt(process.getuid())) {
    throw new Error('legacy relay public endpoint fence has a foreign owner')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
