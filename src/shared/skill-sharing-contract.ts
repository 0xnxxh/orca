import type {
  SkillCloudOperation,
  SkillCloudPublishResult,
  SkillCloudVersion
} from './skill-cloud-contract'
import type {
  SkillInstallDestination,
  SkillInstallPreview,
  SkillInstallResult,
  SkillPackageIdentity,
  ManagedSkillInstall
} from './skill-install-contract'

export type SkillSharePreview = {
  preparationId: string
  packageId: string
  versionId: string
  name: string
  description: string
  packageDigest: string
  archiveSha256: string
  fileCount: number
  totalBytes: number
  compressedBytes: number
  scriptPaths: string[]
  executablePaths: string[]
  expiresAt: string
}

export type SkillSharePublishInput = {
  preparationId: string
  releaseNotes: string
  userIds: string[]
  shareWithOrganization: boolean
}

export type SkillSharePublishOperation = SkillCloudOperation<SkillCloudPublishResult>

export type SkillShareResolvedOperation = SkillCloudOperation<{
  id: string
  version: SkillCloudVersion
}>

export type SkillShareProgress = {
  preparationId: string
  phase: 'uploading' | 'finalizing'
  bytesSent: number
  totalBytes: number
}

export type SkillInstallProgress = {
  operationId: string
  phase: 'authorizing' | 'installing'
}

export type SkillShareInstallInput = {
  shareId: string
  operationId?: string
  versionId?: string
  environmentId?: string
  destination: SkillInstallDestination
  conflictResolution?: 'replace-unmodified' | 'replace-and-discard-local' | 'cancel'
}

export type SkillPackageVersionInstallInput = Omit<SkillShareInstallInput, 'shareId'> & {
  packageId: string
  versionId: string
}

export type SkillShareInstallOperation =
  | { status: 'ok'; value: SkillInstallResult }
  | { status: 'unconfigured'; message: string }
  | { status: 'reconnect-required' }
  | { status: 'unsupported'; message: string }

export type SkillInstallPreviewInput = {
  environmentId?: string
  package: SkillPackageIdentity
  name: string
  destination: SkillInstallDestination
}

export type SkillInstallPreviewOperation =
  | { status: 'ok'; value: SkillInstallPreview }
  | { status: 'unsupported'; message: string }

export type SkillRemoveInput = {
  environmentId?: string
  name: string
  destination: SkillInstallDestination
  conflictResolution?: 'replace-and-discard-local' | 'cancel'
}

export type SkillRemoveOperation =
  | { status: 'ok'; value: SkillInstallResult }
  | { status: 'unsupported'; message: string }

export type SkillInstallCancelInput = {
  operationId: string
  environmentId?: string
}

export type ManagedSkillInstallListOperation =
  | { status: 'ok'; value: ManagedSkillInstall[] }
  | { status: 'unsupported'; message: string }
