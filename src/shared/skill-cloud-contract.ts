import type { SkillPackageManifestV1 } from './skill-package-manifest'

export type SkillCloudOptions = {
  apiUrl?: string
  authToken?: string
}

export type SkillCloudInstallTarget = 'local' | 'remote'

export type SkillCloudOperation<T> =
  | { status: 'ok'; value: T }
  | { status: 'unconfigured'; message: string }
  | { status: 'reconnect-required' }

export type SkillCloudVersion = {
  packageId: string
  versionId: string
  name: string
  description: string
  packageDigest: string
  archiveSha256: string
  compressedBytes: number
  createdAt: string
  releaseNotes: string
  manifest: SkillPackageManifestV1
  publisher?: { userId: string; organizationId?: string }
}

export type SkillCloudShare = {
  id: string
  url: string
}

export type SkillCloudDownloadGrant = {
  grant: { url: string; expiresAt: string }
  version: SkillCloudVersion
}

export type SkillCloudPackageDetails = {
  id: string
  name: string
  description: string
  createdAt: string
  canManage: boolean
  versions: SkillCloudVersion[]
}

export type SkillCloudPublishRequest = SkillCloudOptions & {
  archivePath: string
  archiveSha256: string
  compressedBytes: number
  packageId: string
  releaseNotes: string
  pinnedVersionId?: string
  userIds: string[]
  shareWithOrganization: boolean
  onProgress?: (progress: {
    phase: 'uploading' | 'finalizing'
    bytesSent: number
    totalBytes: number
  }) => void
  signal?: AbortSignal
}

export type SkillCloudPublishResult = {
  version: SkillCloudVersion
  share: SkillCloudShare
}
