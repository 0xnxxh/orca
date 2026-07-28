import {
  MobileWebWorkspaceActivationPayloadSchema,
  MobileWebWorkspaceActivationResultSchema,
  MobileWebWorkspaceRemovePayloadSchema,
  MobileWebWorkspaceRemoveResultSchema,
  MobileWebWorkspaceRepositoriesPayloadSchema,
  MobileWebWorkspaceRepositoriesResultSchema,
  MobileWebWorkspaceSettingsSnapshotPayloadSchema,
  MobileWebWorkspaceSettingsSnapshotResultSchema,
  MobileWebWorkspaceSettingsUpdatePayloadSchema,
  MobileWebWorkspaceSettingsUpdateResultSchema,
  MobileWebWorkspaceSnapshotPayloadSchema,
  MobileWebWorkspaceSnapshotResultSchema,
  MobileWebWorkspaceUpdatePayloadSchema,
  MobileWebWorkspaceUpdateResultSchema,
  type MobileWebWorkspaceActivationPayload,
  type MobileWebWorkspaceActivationResult,
  type MobileWebWorkspaceRemovePayload,
  type MobileWebWorkspaceRemoveResult,
  type MobileWebWorkspaceRepositoriesResult,
  type MobileWebWorkspaceSnapshotPayload,
  type MobileWebWorkspaceSnapshotResult,
  type MobileWebWorkspaceUpdatePayload,
  type MobileWebWorkspaceUpdateResult,
  type MobileWebWorkspaceViewSettings
} from '../../shared/mobile-web/bridge-operation-contract'
import type { MobileWebOneShotRequestClient } from './mobile-web-one-shot-request-client'

export class MobileWebWorkspaceRequestClient {
  constructor(private readonly requests: MobileWebOneShotRequestClient) {}

  snapshot(payload: MobileWebWorkspaceSnapshotPayload): Promise<MobileWebWorkspaceSnapshotResult> {
    return this.requests.request(
      'workspace',
      'snapshot',
      payload,
      MobileWebWorkspaceSnapshotPayloadSchema,
      MobileWebWorkspaceSnapshotResultSchema
    )
  }

  activate(
    payload: MobileWebWorkspaceActivationPayload
  ): Promise<MobileWebWorkspaceActivationResult> {
    return this.requests.request(
      'workspace',
      'activate',
      payload,
      MobileWebWorkspaceActivationPayloadSchema,
      MobileWebWorkspaceActivationResultSchema
    )
  }

  repositories(): Promise<MobileWebWorkspaceRepositoriesResult> {
    return this.requests.request(
      'workspace',
      'repositories',
      {},
      MobileWebWorkspaceRepositoriesPayloadSchema,
      MobileWebWorkspaceRepositoriesResultSchema
    )
  }

  update(payload: MobileWebWorkspaceUpdatePayload): Promise<MobileWebWorkspaceUpdateResult> {
    return this.requests.request(
      'workspace',
      'update',
      payload,
      MobileWebWorkspaceUpdatePayloadSchema,
      MobileWebWorkspaceUpdateResultSchema
    )
  }

  remove(payload: MobileWebWorkspaceRemovePayload): Promise<MobileWebWorkspaceRemoveResult> {
    return this.requests.request(
      'workspace',
      'remove',
      payload,
      MobileWebWorkspaceRemovePayloadSchema,
      MobileWebWorkspaceRemoveResultSchema
    )
  }

  settingsSnapshot(): Promise<{ settings: MobileWebWorkspaceViewSettings | null }> {
    return this.requests.request(
      'settings',
      'snapshot',
      {},
      MobileWebWorkspaceSettingsSnapshotPayloadSchema,
      MobileWebWorkspaceSettingsSnapshotResultSchema
    )
  }

  settingsUpdate(payload: MobileWebWorkspaceViewSettings): Promise<null> {
    return this.requests.request(
      'settings',
      'update',
      payload,
      MobileWebWorkspaceSettingsUpdatePayloadSchema,
      MobileWebWorkspaceSettingsUpdateResultSchema
    )
  }
}
