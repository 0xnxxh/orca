import { defineMethod, type RpcMethod } from '../core'
import { SkillDiscoveryTargetSchema } from '../../../../shared/skills'
import {
  SkillInstallPreviewRequestSchema,
  SkillInstallRequestSchema,
  SkillRemoveRequestSchema
} from '../../../../shared/skill-install-contract'
import {
  SkillUploadBeginRequestSchema,
  SkillUploadChunkRequestSchema,
  SkillUploadCommitRequestSchema
} from '../../../../shared/skill-upload-session-contract'
import {
  discoverSkillsOnTarget,
  resolveSkillDiscoveryTarget
} from '../../../skills/skill-discovery-target'

export const SKILL_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'skills.discover',
    params: SkillDiscoveryTargetSchema.default({}),
    handler: async (params, { runtime }) => {
      // Why: the executing runtime owns WSL project preferences. Remote callers
      // send worktree identity only; trusting their projectRuntime absence
      // would scan this host's native filesystem for a WSL-configured project.
      const target = params.projectRuntime
        ? params
        : {
            ...params,
            projectRuntime: runtime.resolveProjectRuntimeForWorktree(params.worktreeId)
          }
      return discoverSkillsOnTarget(resolveSkillDiscoveryTarget(target), runtime.listRepos())
    }
  }),
  defineMethod({
    name: 'skills.install',
    params: SkillInstallRequestSchema,
    handler: (params, { runtime, signal }) => runtime.installSharedSkillRequest(params, signal)
  }),
  defineMethod({
    name: 'skills.previewInstall',
    params: SkillInstallPreviewRequestSchema,
    handler: (params, { runtime }) => runtime.previewSharedSkillInstallRequest(params)
  }),
  defineMethod({
    name: 'skills.removeInstall',
    params: SkillRemoveRequestSchema,
    handler: (params, { runtime }) => runtime.removeSharedSkillInstallRequest(params)
  }),
  defineMethod({
    name: 'skills.listManagedInstalls',
    params: null,
    handler: (_params, { runtime }) => runtime.listManagedSkillInstalls()
  }),
  defineMethod({
    name: 'skills.beginUpload',
    params: SkillUploadBeginRequestSchema,
    handler: (params, { runtime }) => runtime.beginSkillUpload(params)
  }),
  defineMethod({
    name: 'skills.uploadChunk',
    params: SkillUploadChunkRequestSchema,
    handler: (params, { runtime }) => runtime.appendSkillUploadChunk(params)
  }),
  defineMethod({
    name: 'skills.commitUpload',
    params: SkillUploadCommitRequestSchema,
    handler: (params, { runtime }) => runtime.commitSkillUpload(params.uploadId)
  }),
  defineMethod({
    name: 'skills.cancelUpload',
    params: SkillUploadCommitRequestSchema,
    handler: (params, { runtime }) => runtime.cancelSkillUpload(params.uploadId)
  })
]
