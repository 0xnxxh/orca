import { open } from 'node:fs/promises'
import type { SshTarget } from '../../shared/ssh-types'
import type { SshResolvedConfig } from './ssh-config-parser'
import { resolveIdentityFilePaths } from './ssh-auth-resolution'
import { resolveSshConfigHomePath } from './ssh-config-path-expansion'
import {
  isOpenSshSecurityKeyPrivateKey,
  isOpenSshSecurityKeyPublicKey
} from './ssh-security-key-identity'
import { isOpenSshConfigBackedTarget } from './system-ssh-args'

type TransportResolvedConfig = Pick<
  SshResolvedConfig,
  'proxyUseFdpass' | 'proxyCommand' | 'proxyJump'
>

const MAX_SECURITY_KEY_FILE_BYTES = 1024 * 1024

async function readBoundedKeyFile(path: string): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > MAX_SECURITY_KEY_FILE_BYTES) {
      return null
    }
    const contents = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < contents.length) {
      const { bytesRead } = await handle.read(contents, offset, contents.length - offset, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    return contents.subarray(0, offset)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export function shouldUseSystemSshTransport(
  target: SshTarget,
  resolved: TransportResolvedConfig | null
): boolean {
  if (isOpenSshConfigBackedTarget(target) && resolved) {
    return (
      process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT === '1' ||
      resolved.proxyUseFdpass === true ||
      resolved.proxyCommand != null ||
      resolved.proxyJump != null
    )
  }
  return (
    process.env.ORCA_SSH_FORCE_SYSTEM_TRANSPORT === '1' ||
    target.proxyCommand != null ||
    target.jumpHost != null ||
    resolved?.proxyUseFdpass === true ||
    resolved?.proxyCommand != null ||
    resolved?.proxyJump != null
  )
}

export async function requiresSystemSshForSecurityKey(
  target: SshTarget,
  resolved: Pick<SshResolvedConfig, 'identityFile'> | null
): Promise<boolean> {
  for (const keyPath of resolveIdentityFilePaths(target, resolved)) {
    const resolvedPath = resolveSshConfigHomePath(keyPath)
    for (const candidate of [`${resolvedPath}.pub`, resolvedPath]) {
      const contents = await readBoundedKeyFile(candidate)
      if (
        contents &&
        (isOpenSshSecurityKeyPublicKey(contents) || isOpenSshSecurityKeyPrivateKey(contents))
      ) {
        return true
      }
    }
  }
  return false
}
