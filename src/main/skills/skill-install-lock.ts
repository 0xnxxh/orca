import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SKILL_INSTALL_BUSY_FAILURE } from '../../shared/skill-install-failure'
import { SkillInstallOperationError } from './skill-install-operation-error'
import { skillInstallStateKey } from './skill-install-provenance'

const LOCK_RETRY_MS = 50
const LOCK_STALE_MS = 30 * 60 * 1000

type SkillInstallLockOwner = {
  token: string
  pid: number
  createdAt: number
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function removeStaleLock(path: string): Promise<void> {
  const lockStat = await stat(path).catch(() => null)
  if (!lockStat) {
    return
  }
  let owner: SkillInstallLockOwner | null = null
  try {
    owner = JSON.parse(await readFile(path, 'utf8')) as SkillInstallLockOwner
  } catch {
    owner = null
  }
  if (owner && Number.isInteger(owner.pid)) {
    if (processIsAlive(owner.pid)) {
      return
    }
    await rm(path, { force: true })
    return
  }
  if (Date.now() - lockStat.mtimeMs >= LOCK_STALE_MS) {
    await rm(path, { force: true })
  }
}

export function skillInstallLockPath(stateDirectory: string, canonicalPath: string): string {
  return join(stateDirectory, 'locks', `${skillInstallStateKey(canonicalPath)}.lock`)
}

export async function acquireSkillInstallLock(input: {
  path: string
  timeoutMs?: number
}): Promise<() => Promise<void>> {
  await mkdir(dirname(input.path), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + (input.timeoutMs ?? 5_000)
  const owner: SkillInstallLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    createdAt: Date.now()
  }
  for (;;) {
    try {
      const handle = await open(input.path, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(owner), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      return async () => {
        let current: SkillInstallLockOwner | null = null
        try {
          current = JSON.parse(await readFile(input.path, 'utf8')) as SkillInstallLockOwner
        } catch {
          current = null
        }
        if (current?.token === owner.token) {
          await rm(input.path, { force: true })
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      await removeStaleLock(input.path)
      if (Date.now() >= deadline) {
        throw new SkillInstallOperationError(SKILL_INSTALL_BUSY_FAILURE)
      }
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}
