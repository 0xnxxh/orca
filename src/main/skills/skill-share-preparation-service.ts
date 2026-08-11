import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  SkillSharePreview,
  SkillShareProgress,
  SkillSharePublishInput,
  SkillSharePublishOperation
} from '../../shared/skill-sharing-contract'
import { createSkillPackageArchive, type CreatedSkillPackage } from './skill-package-creation'
import type { SkillCloudService } from './skill-cloud-service'

const PREPARATION_TTL_MS = 30 * 60 * 1000
const MAX_PREPARATIONS = 8

type Preparation = {
  created: CreatedSkillPackage
  expiresAt: number
  controller: AbortController | null
}

function preview(id: string, value: Preparation): SkillSharePreview {
  const manifest = value.created.manifest
  return {
    preparationId: id,
    packageId: manifest.packageId,
    versionId: manifest.versionId,
    name: manifest.name,
    description: manifest.description,
    packageDigest: manifest.packageDigest,
    archiveSha256: value.created.archiveSha256,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + file.size, 0),
    compressedBytes: value.created.compressedBytes,
    scriptPaths: manifest.files
      .filter((file) => file.path.startsWith('scripts/'))
      .map((file) => file.path),
    executablePaths: manifest.files.filter((file) => file.executable).map((file) => file.path),
    expiresAt: new Date(value.expiresAt).toISOString()
  }
}

export class SkillSharePreparationService {
  private readonly preparations = new Map<string, Preparation>()

  constructor(
    private readonly root: string,
    private readonly cloud: Pick<SkillCloudService, 'publish'>
  ) {}

  async prepare(input: {
    sourceDirectory: string
    packageId?: string
  }): Promise<SkillSharePreview> {
    await this.prune()
    if (this.preparations.size >= MAX_PREPARATIONS) {
      throw new Error('skill-share-preparation-limit')
    }
    const preparationId = randomUUID()
    const directory = join(this.root, preparationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      const created = await createSkillPackageArchive({
        sourceDirectory: input.sourceDirectory,
        archivePath: join(directory, 'package.tar.gz'),
        packageId: input.packageId ?? randomUUID(),
        versionId: randomUUID()
      })
      const value: Preparation = {
        created,
        expiresAt: Date.now() + PREPARATION_TTL_MS,
        controller: null
      }
      this.preparations.set(preparationId, value)
      return preview(preparationId, value)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async publish(
    input: SkillSharePublishInput,
    onProgress?: (progress: SkillShareProgress) => void
  ): Promise<SkillSharePublishOperation> {
    await this.prune()
    const preparation = this.preparations.get(input.preparationId)
    if (!preparation || preparation.expiresAt <= Date.now()) {
      throw new Error('skill-share-preparation-expired')
    }
    if (preparation.controller) {
      throw new Error('skill-share-publish-in-progress')
    }
    const controller = new AbortController()
    preparation.controller = controller
    try {
      const result = await this.cloud.publish({
        archivePath: preparation.created.archivePath,
        archiveSha256: preparation.created.archiveSha256,
        compressedBytes: preparation.created.compressedBytes,
        packageId: preparation.created.manifest.packageId,
        releaseNotes: input.releaseNotes,
        userIds: input.userIds,
        shareWithOrganization: input.shareWithOrganization,
        signal: controller.signal,
        onProgress: (progress) => onProgress?.({ preparationId: input.preparationId, ...progress })
      })
      if (result.status === 'ok') {
        await this.release(input.preparationId)
      }
      return result satisfies SkillSharePublishOperation
    } finally {
      const current = this.preparations.get(input.preparationId)
      if (current) {
        current.controller = null
      }
    }
  }

  cancel(preparationId: string): void {
    this.preparations.get(preparationId)?.controller?.abort()
  }

  async release(preparationId: string): Promise<void> {
    const preparation = this.preparations.get(preparationId)
    preparation?.controller?.abort()
    this.preparations.delete(preparationId)
    await rm(join(this.root, preparationId), { recursive: true, force: true })
  }

  async dispose(): Promise<void> {
    for (const preparation of this.preparations.values()) {
      preparation.controller?.abort()
    }
    this.preparations.clear()
    await rm(this.root, { recursive: true, force: true })
  }

  private async prune(): Promise<void> {
    const expired = [...this.preparations.entries()]
      .filter(([, value]) => value.expiresAt <= Date.now() && !value.controller)
      .map(([id]) => id)
    await Promise.all(expired.map((id) => this.release(id)))
  }
}
