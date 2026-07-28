import {
  MobileWebCreationAgentDetectionPayloadSchema,
  MobileWebCreationAgentDetectionResultSchema,
  MobileWebCreationAvailabilityPayloadSchema,
  MobileWebCreationAvailabilityResultSchema,
  MobileWebCreationPersistTrustPayloadSchema,
  MobileWebCreationRepoHooksResultSchema,
  MobileWebCreationRepoPayloadSchema,
  MobileWebCreationRepositoriesPayloadSchema,
  MobileWebCreationRepositoriesResultSchema,
  MobileWebCreationRuntimeCapabilitiesPayloadSchema,
  MobileWebCreationRuntimeCapabilitiesResultSchema,
  MobileWebCreationSettingsPayloadSchema,
  MobileWebCreationSettingsResultSchema,
  MobileWebCreationSparsePresetSavePayloadSchema,
  MobileWebCreationSparsePresetSaveResultSchema,
  MobileWebCreationSparsePresetsResultSchema,
  MobileWebCreationSshStateResultSchema,
  MobileWebCreationTrustedHooksPayloadSchema,
  MobileWebCreationTrustedHooksResultSchema,
  type MobileWebCreationAgentDetectionPayload,
  type MobileWebCreationPersistTrustPayload,
  type MobileWebCreationRepoHooksResult,
  type MobileWebCreationRepoPayload,
  type MobileWebCreationRepositoriesResult,
  type MobileWebCreationSettingsResult,
  type MobileWebCreationSparsePresetSavePayload,
  type MobileWebCreationSshStateResult,
  type MobileWebCreationTrustedHooksResult
} from '../../shared/mobile-web/workspace-creation-read-contract'
import type { MobileWebOneShotRequestClient } from './mobile-web-one-shot-request-client'

export class MobileWebWorkspaceCreationRequestClient {
  constructor(private readonly requests: MobileWebOneShotRequestClient) {}

  repositories(): Promise<MobileWebCreationRepositoriesResult> {
    return this.emptyRequest(
      'creationRepositories',
      MobileWebCreationRepositoriesPayloadSchema,
      MobileWebCreationRepositoriesResultSchema
    )
  }

  settings(): Promise<MobileWebCreationSettingsResult> {
    return this.emptyRequest(
      'creationSettings',
      MobileWebCreationSettingsPayloadSchema,
      MobileWebCreationSettingsResultSchema
    )
  }

  trustedHooks(): Promise<MobileWebCreationTrustedHooksResult> {
    return this.emptyRequest(
      'creationTrustedHooks',
      MobileWebCreationTrustedHooksPayloadSchema,
      MobileWebCreationTrustedHooksResultSchema
    )
  }

  gitLabAvailable(): Promise<boolean> {
    return this.availability('creationGitLabAvailability')
  }

  linearAvailable(): Promise<boolean> {
    return this.availability('creationLinearAvailability')
  }

  sshState(payload: MobileWebCreationRepoPayload): Promise<MobileWebCreationSshStateResult> {
    return this.repoRequest('creationSshState', payload, MobileWebCreationSshStateResultSchema)
  }

  sshConnect(payload: MobileWebCreationRepoPayload): Promise<MobileWebCreationSshStateResult> {
    return this.repoRequest('creationSshConnect', payload, MobileWebCreationSshStateResultSchema)
  }

  detectAgents(payload: MobileWebCreationAgentDetectionPayload): Promise<string[]> {
    return this.requests
      .request(
        'workspace',
        'creationDetectAgents',
        payload,
        MobileWebCreationAgentDetectionPayloadSchema,
        MobileWebCreationAgentDetectionResultSchema
      )
      .then((result) => result.agentIds)
  }

  repoHooks(payload: MobileWebCreationRepoPayload): Promise<MobileWebCreationRepoHooksResult> {
    return this.repoRequest('creationRepoHooks', payload, MobileWebCreationRepoHooksResultSchema)
  }

  runtimeCapabilities(): Promise<{
    tasksSupported: boolean
    idempotentWorktreeCreateSupported: boolean
  }> {
    return this.emptyRequest(
      'creationRuntimeCapabilities',
      MobileWebCreationRuntimeCapabilitiesPayloadSchema,
      MobileWebCreationRuntimeCapabilitiesResultSchema
    )
  }

  sparsePresets(payload: MobileWebCreationRepoPayload) {
    return this.requests
      .request(
        'workspace',
        'creationSparsePresets',
        payload,
        MobileWebCreationRepoPayloadSchema,
        MobileWebCreationSparsePresetsResultSchema
      )
      .then((result) => result.presets)
  }

  saveSparsePreset(payload: MobileWebCreationSparsePresetSavePayload) {
    return this.requests
      .request(
        'workspace',
        'creationSaveSparsePreset',
        payload,
        MobileWebCreationSparsePresetSavePayloadSchema,
        MobileWebCreationSparsePresetSaveResultSchema
      )
      .then((result) => result.preset)
  }

  persistTrust(
    payload: MobileWebCreationPersistTrustPayload
  ): Promise<MobileWebCreationTrustedHooksResult> {
    return this.requests.request(
      'workspace',
      'creationPersistTrust',
      payload,
      MobileWebCreationPersistTrustPayloadSchema,
      MobileWebCreationTrustedHooksResultSchema
    )
  }

  private availability(operation: string): Promise<boolean> {
    return this.emptyRequest<{ available: boolean }>(
      operation,
      MobileWebCreationAvailabilityPayloadSchema,
      MobileWebCreationAvailabilityResultSchema
    ).then((result) => result.available)
  }

  private repoRequest<TResult>(
    operation: string,
    payload: MobileWebCreationRepoPayload,
    resultSchema: Parameters<MobileWebOneShotRequestClient['request']>[4]
  ): Promise<TResult> {
    return this.requests.request(
      'workspace',
      operation,
      payload,
      MobileWebCreationRepoPayloadSchema,
      resultSchema
    ) as Promise<TResult>
  }

  private emptyRequest<TResult>(
    operation: string,
    payloadSchema: Parameters<MobileWebOneShotRequestClient['request']>[3],
    resultSchema: Parameters<MobileWebOneShotRequestClient['request']>[4]
  ): Promise<TResult> {
    return this.requests.request(
      'workspace',
      operation,
      {},
      payloadSchema,
      resultSchema
    ) as Promise<TResult>
  }
}
