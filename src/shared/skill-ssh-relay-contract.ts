import { z } from 'zod'
import {
  SkillInstallPreviewRequestSchema,
  SkillInstallRequestSchema,
  SkillRemoveRequestSchema
} from './skill-install-contract'

export const SKILL_SSH_RELAY_INSTALL_METHOD = 'skills.install' as const
export const SKILL_SSH_RELAY_PREVIEW_METHOD = 'skills.previewInstall' as const
export const SKILL_SSH_RELAY_REMOVE_METHOD = 'skills.removeInstall' as const
export const SKILL_SSH_RELAY_LIST_METHOD = 'skills.listManagedInstalls' as const
export const SKILL_SSH_RELAY_BEGIN_UPLOAD_METHOD = 'skills.beginUpload' as const
export const SKILL_SSH_RELAY_UPLOAD_CHUNK_METHOD = 'skills.uploadChunk' as const
export const SKILL_SSH_RELAY_COMMIT_UPLOAD_METHOD = 'skills.commitUpload' as const
export const SKILL_SSH_RELAY_CANCEL_UPLOAD_METHOD = 'skills.cancelUpload' as const

const SkillSshWorkspaceAuthoritySchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('worktree'), id: z.string().min(1), path: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal('folder'), id: z.string().min(1), path: z.string().min(1) }).strict()
])

export const SkillSshInstallParamsSchema = z
  .object({
    request: SkillInstallRequestSchema,
    workspace: SkillSshWorkspaceAuthoritySchema.optional()
  })
  .strict()

export const SkillSshPreviewParamsSchema = z
  .object({
    request: SkillInstallPreviewRequestSchema,
    workspace: SkillSshWorkspaceAuthoritySchema.optional()
  })
  .strict()

export const SkillSshRemoveParamsSchema = z
  .object({
    request: SkillRemoveRequestSchema,
    workspace: SkillSshWorkspaceAuthoritySchema.optional()
  })
  .strict()

export const SkillSshListParamsSchema = z
  .object({ workspaces: z.array(SkillSshWorkspaceAuthoritySchema).max(4096) })
  .strict()

export type SkillSshWorkspaceAuthority = z.infer<typeof SkillSshWorkspaceAuthoritySchema>
export type SkillSshInstallParams = z.infer<typeof SkillSshInstallParamsSchema>
export type SkillSshPreviewParams = z.infer<typeof SkillSshPreviewParamsSchema>
export type SkillSshRemoveParams = z.infer<typeof SkillSshRemoveParamsSchema>
