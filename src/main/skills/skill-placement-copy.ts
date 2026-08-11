import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SkillInstalledFileMode, SkillInstallFilesystem } from './skill-install-filesystem'

export async function createVerifiedSkillPlacementCopy(
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

export async function replaceOwnedSkillPlacementCopy(
  canonicalPath: string,
  destinationPath: string,
  filesystem: SkillInstallFilesystem,
  fileModes?: readonly SkillInstalledFileMode[]
): Promise<void> {
  const replacement = `${destinationPath}.orca-copy-${randomUUID()}`
  const backup = `${destinationPath}.orca-backup-${randomUUID()}`
  try {
    await createVerifiedSkillPlacementCopy(canonicalPath, replacement, filesystem, fileModes)
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

export async function createSkillPlacementCopyAtMissingDestination(
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
