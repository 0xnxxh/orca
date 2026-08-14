import { defineMethod, type RpcMethod } from '../core'
import { z } from 'zod'
import { SkillDiscoveryTargetSchema } from '../../../../shared/skills'
import {
  SkillInstallPreviewRequestSchema,
  SkillInstallRequestSchema,
  SkillRemoveRequestSchema
} from '../../../../shared/skill-install-contract'
import {
  SkillBundleInstallProgressSchema,
  SkillBundleInstallRequestSchema
} from '../../../../shared/skill-bundle-install-contract'
import {
  SkillUploadBeginRequestSchema,
  SkillUploadChunkRequestSchema,
  SkillUploadCommitRequestSchema
} from '../../../../shared/skill-upload-session-contract'
import {
  discoverSkillsOnTarget,
  resolveSkillDiscoveryTarget
} from '../../../skills/skill-discovery-target'
import { SKILL_INSTALL_RESULT_V2_CAPABILITY } from '../../../../shared/skill-install-capability'

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
      const resolvedTarget = resolveSkillDiscoveryTarget(target)
      return discoverSkillsOnTarget(resolvedTarget, runtime.listRepos(), {
        providerRootOverrides: await runtime.resolveSkillDiscoveryProviderRoots(resolvedTarget),
        refresh: params.refresh === true
      })
    }
  }),
  defineMethod({
    name: 'skills.install',
    params: SkillInstallRequestSchema,
    handler: async (params, { runtime, signal, clientCapabilities }) => {
      const result = await runtime.installSharedSkillRequest(params, signal)
      if (
        result.status === 'cancelled' &&
        !clientCapabilities?.includes(SKILL_INSTALL_RESULT_V2_CAPABILITY)
      ) {
        return {
          ...result,
          status: 'failed' as const,
          errorCategory: result.failure?.code ?? 'skill-install-cancelled',
          failure: undefined
        }
      }
      return result
    }
  }),
  defineMethod({
    name: 'skills.installBundle',
    params: SkillBundleInstallRequestSchema,
    handler: (params, { runtime, signal }) =>
      runtime.installSharedSkillBundleRequest(params, signal)
  }),
  defineMethod({
    name: 'skills.cancelInstall',
    params: z.object({ operationId: z.string().min(1).max(128) }).strict(),
    handler: (params, { runtime }) => ({
      cancelled: runtime.cancelSharedSkillInstall(params.operationId)
    })
  }),
  defineMethod({
    name: 'skills.getInstallProgress',
    params: z.object({ operationId: z.string().min(1).max(128) }).strict(),
    handler: (params, { runtime }) => {
      const progress = runtime.getSharedSkillInstallProgress(params.operationId)
      return progress ? SkillBundleInstallProgressSchema.parse(progress) : null
    }
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
