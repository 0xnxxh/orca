import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, realpath, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { SkillPlacementResult } from '../../shared/skill-install-contract'
import type { SkillInstallReceiptV1 } from './skill-install-provenance'
import type { SkillProviderDestination } from './skill-provider-destinations'
import {
  nativeSkillInstallFilesystem,
  type SkillInstalledFileMode,
  type SkillInstallFilesystem
} from './skill-install-filesystem'

function normalizedPath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

async function pathExists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => null))
}

function previousPlacement(
  receipt: SkillInstallReceiptV1 | null,
  provider: string,
  path: string
): SkillPlacementResult | null {
  return (
    receipt?.placements.find(
      (placement) =>
        placement.provider === provider && normalizedPath(placement.path) === normalizedPath(path)
    ) ?? null
  )
}

async function createProviderAlias(
  canonicalPath: string,
  destinationPath: string,
  filesystem: SkillInstallFilesystem
): Promise<void> {
  if (filesystem.createAlias) {
    await filesystem.createAlias(canonicalPath, destinationPath)
    return
  }
  const parent = dirname(destinationPath)
  await mkdir(parent, { recursive: true })
  if (process.platform === 'win32') {
    await symlink(resolve(canonicalPath), destinationPath, 'junction')
    return
  }
  const realParent = await realpath(parent).catch(() => resolve(parent))
  const realCanonical = await realpath(canonicalPath)
  await symlink(relative(realParent, realCanonical), destinationPath, 'dir')
}

async function createVerifiedCopy(
  canonicalPath: string,
  destinationPath: string,
  filesystem: SkillInstallFilesystem,
  fileModes?: readonly SkillInstalledFileMode[]
): Promise<void> {
  const temporary = `${destinationPath}.orca-copy-${randomUUID()}`
  try {
    await cp(canonicalPath, temporary, { recursive: true, verbatimSymlinks: true })
    const [source, copied] = await Promise.all([
      filesystem.observeSkill(canonicalPath, fileModes),
      filesystem.observeSkill(temporary, fileModes)
    ])
    if (source.observedDigest !== copied.observedDigest) {
      throw new Error('skill-placement-copy-digest-mismatch')
    }
    await filesystem.rename(temporary, destinationPath)
  } finally {
    await filesystem.remove(temporary)
  }
}

async function replaceOwnedCopy(
  canonicalPath: string,
  destinationPath: string,
  filesystem: SkillInstallFilesystem,
  fileModes?: readonly SkillInstalledFileMode[]
): Promise<void> {
  const replacement = `${destinationPath}.orca-copy-${randomUUID()}`
  const backup = `${destinationPath}.orca-backup-${randomUUID()}`
  try {
    await createVerifiedCopy(canonicalPath, replacement, filesystem, fileModes)
    await filesystem.rename(destinationPath, backup)
    try {
      await filesystem.rename(replacement, destinationPath)
    } catch (error) {
      await filesystem.rename(backup, destinationPath)
      throw error
    }
    await filesystem.remove(backup)
  } finally {
    await filesystem.remove(replacement)
  }
}

async function reconcileExistingPlacement(input: {
  canonicalPath: string
  destinationPath: string
  destination: SkillProviderDestination
  previousReceipt: SkillInstallReceiptV1 | null
  packageDigest: string
  filesystem: SkillInstallFilesystem
  fileModes?: readonly SkillInstalledFileMode[]
}): Promise<SkillPlacementResult> {
  if (input.filesystem.aliasTargets) {
    return (await input.filesystem.aliasTargets(input.canonicalPath, input.destinationPath))
      ? {
          provider: input.destination.provider,
          path: input.destinationPath,
          topology: 'provider-alias',
          status: 'unchanged'
        }
      : {
          provider: input.destination.provider,
          path: input.destinationPath,
          topology: 'provider-alias',
          status: 'skipped',
          errorCategory: 'skill-placement-unowned-link'
        }
  }
  const stat = await lstat(input.destinationPath)
  const previous = previousPlacement(
    input.previousReceipt,
    input.destination.provider,
    input.destinationPath
  )
  if (stat.isSymbolicLink()) {
    const target = await realpath(input.destinationPath).catch(() => null)
    if (target && normalizedPath(target) === normalizedPath(input.canonicalPath)) {
      return {
        provider: input.destination.provider,
        path: input.destinationPath,
        topology: 'provider-alias',
        status: 'unchanged'
      }
    }
    return {
      provider: input.destination.provider,
      path: input.destinationPath,
      topology: 'provider-alias',
      status: 'skipped',
      errorCategory: 'skill-placement-unowned-link'
    }
  }
  if (stat.isDirectory() && previous?.topology === 'independent-copy') {
    const observed = await input.filesystem
      .observeSkill(input.destinationPath, input.previousReceipt?.fileModes)
      .catch(() => null)
    if (!observed || observed.observedDigest !== input.previousReceipt?.packageDigest) {
      return {
        provider: input.destination.provider,
        path: input.destinationPath,
        topology: 'independent-copy',
        status: 'skipped',
        errorCategory: 'skill-placement-modified-copy'
      }
    }
    if (observed.observedDigest === input.packageDigest) {
      return {
        provider: input.destination.provider,
        path: input.destinationPath,
        topology: 'independent-copy',
        status: 'unchanged'
      }
    }
    await replaceOwnedCopy(
      input.canonicalPath,
      input.destinationPath,
      input.filesystem,
      input.fileModes
    )
    return {
      provider: input.destination.provider,
      path: input.destinationPath,
      topology: 'independent-copy',
      status: 'installed'
    }
  }
  return {
    provider: input.destination.provider,
    path: input.destinationPath,
    topology: 'independent-copy',
    status: 'skipped',
    errorCategory: 'skill-placement-unowned'
  }
}

async function createMissingPlacement(input: {
  canonicalPath: string
  destinationPath: string
  destination: SkillProviderDestination
  filesystem: SkillInstallFilesystem
  fileModes?: readonly SkillInstalledFileMode[]
}): Promise<SkillPlacementResult> {
  try {
    await createProviderAlias(input.canonicalPath, input.destinationPath, input.filesystem)
    return {
      provider: input.destination.provider,
      path: input.destinationPath,
      topology: 'provider-alias',
      status: 'installed'
    }
  } catch {
    if (input.filesystem.createAlias) {
      return {
        provider: input.destination.provider,
        path: input.destinationPath,
        topology: 'provider-alias',
        status: 'failed',
        errorCategory: 'skill-placement-create-failed'
      }
    }
    try {
      await createVerifiedCopyAtMissingDestination(
        input.canonicalPath,
        input.destinationPath,
        input.filesystem,
        input.fileModes
      )
      return {
        provider: input.destination.provider,
        path: input.destinationPath,
        topology: 'independent-copy',
        status: 'installed'
      }
    } catch {
      return {
        provider: input.destination.provider,
        path: input.destinationPath,
        topology: 'independent-copy',
        status: 'failed',
        errorCategory: 'skill-placement-create-failed'
      }
    }
  }
}

async function createVerifiedCopyAtMissingDestination(
  canonicalPath: string,
  destinationPath: string,
  filesystem: SkillInstallFilesystem,
  fileModes?: readonly SkillInstalledFileMode[]
): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true })
  await mkdir(destinationPath, { mode: 0o700 })
  let complete = false
  try {
    for (const entry of await readdir(canonicalPath)) {
      await cp(join(canonicalPath, entry), join(destinationPath, entry), {
        recursive: true,
        verbatimSymlinks: true,
        force: false,
        errorOnExist: true
      })
    }
    const [source, copied] = await Promise.all([
      filesystem.observeSkill(canonicalPath, fileModes),
      filesystem.observeSkill(destinationPath, fileModes)
    ])
    if (source.observedDigest !== copied.observedDigest) {
      throw new Error('skill-placement-copy-digest-mismatch')
    }
    complete = true
  } finally {
    if (!complete) {
      await filesystem.remove(destinationPath)
    }
  }
}

export async function reconcileSkillProviderPlacement(input: {
  canonicalPath: string
  skillName: string
  destination: SkillProviderDestination
  previousReceipt: SkillInstallReceiptV1 | null
  packageDigest: string
  filesystem?: SkillInstallFilesystem
  fileModes?: readonly SkillInstalledFileMode[]
}): Promise<SkillPlacementResult | null> {
  if (input.destination.readsCanonicalRoot) {
    return null
  }
  const destinationPath = join(input.destination.rootPath, input.skillName)
  const filesystem = input.filesystem ?? nativeSkillInstallFilesystem
  try {
    return (await pathExists(destinationPath))
      ? await reconcileExistingPlacement({ ...input, destinationPath, filesystem })
      : await createMissingPlacement({ ...input, destinationPath, filesystem })
  } catch {
    return {
      provider: input.destination.provider,
      path: destinationPath,
      topology: 'independent-copy',
      status: 'failed',
      errorCategory: 'skill-placement-reconciliation-failed'
    }
  }
}
