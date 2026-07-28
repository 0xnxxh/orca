import {
  MobileWebSessionAgentOptionsPayloadSchema,
  MobileWebSessionAgentOptionsResultSchema,
  MobileWebSessionBrowserCreatePayloadSchema,
  MobileWebSessionBrowserCreateResultSchema,
  MobileWebSessionCapabilitiesPayloadSchema,
  MobileWebSessionCapabilitiesResultSchema,
  MobileWebSessionCloseResultSchema,
  MobileWebSessionCreateAgentPayloadSchema,
  MobileWebSessionCreatePayloadSchema,
  MobileWebSessionCreateResultSchema,
  MobileWebSessionSnapshotPayloadSchema,
  MobileWebSessionSnapshotResultSchema,
  MobileWebSessionTabActionPayloadSchema,
  type MobileWebSessionAgentOptionsPayload,
  type MobileWebSessionAgentOptionsResult,
  type MobileWebSessionBrowserCreatePayload,
  type MobileWebSessionBrowserCreateResult,
  type MobileWebSessionCapabilitiesPayload,
  type MobileWebSessionCapabilitiesResult,
  type MobileWebSessionCloseResult,
  type MobileWebSessionCreateAgentPayload,
  type MobileWebSessionCreatePayload,
  type MobileWebSessionCreateResult,
  type MobileWebSessionSnapshotPayload,
  type MobileWebSessionSnapshotResult,
  type MobileWebSessionTabActionPayload
} from '../../shared/mobile-web/session-operation-contract'
import {
  MobileWebQuickCommandLaunchPayloadSchema,
  MobileWebQuickCommandLaunchResultSchema,
  MobileWebQuickCommandMutationPayloadSchema,
  MobileWebQuickCommandSnapshotPayloadSchema,
  MobileWebQuickCommandSnapshotResultSchema,
  type MobileWebQuickCommandLaunchPayload,
  type MobileWebQuickCommandLaunchResult,
  type MobileWebQuickCommandMutationPayload,
  type MobileWebQuickCommandSnapshotPayload,
  type MobileWebQuickCommandSnapshotResult
} from '../../shared/mobile-web/session-quick-command-contract'
import type { MobileWebOneShotRequestClient } from './mobile-web-one-shot-request-client'

export class MobileWebSessionRequestClient {
  constructor(private readonly requests: MobileWebOneShotRequestClient) {}

  capabilities(
    payload: MobileWebSessionCapabilitiesPayload
  ): Promise<MobileWebSessionCapabilitiesResult> {
    return this.requests.request(
      'session',
      'capabilities',
      payload,
      MobileWebSessionCapabilitiesPayloadSchema,
      MobileWebSessionCapabilitiesResultSchema
    )
  }

  snapshot(payload: MobileWebSessionSnapshotPayload): Promise<MobileWebSessionSnapshotResult> {
    return this.requests.request(
      'session',
      'snapshot',
      payload,
      MobileWebSessionSnapshotPayloadSchema,
      MobileWebSessionSnapshotResultSchema
    )
  }

  activate(payload: MobileWebSessionTabActionPayload): Promise<MobileWebSessionSnapshotResult> {
    return this.requests.request(
      'session',
      'activate',
      payload,
      MobileWebSessionTabActionPayloadSchema,
      MobileWebSessionSnapshotResultSchema
    )
  }

  create(payload: MobileWebSessionCreatePayload): Promise<MobileWebSessionCreateResult> {
    return this.requests.request(
      'session',
      'create',
      payload,
      MobileWebSessionCreatePayloadSchema,
      MobileWebSessionCreateResultSchema
    )
  }

  agentOptions(
    payload: MobileWebSessionAgentOptionsPayload
  ): Promise<MobileWebSessionAgentOptionsResult> {
    return this.requests.request(
      'session',
      'agentOptions',
      payload,
      MobileWebSessionAgentOptionsPayloadSchema,
      MobileWebSessionAgentOptionsResultSchema
    )
  }

  createAgent(payload: MobileWebSessionCreateAgentPayload): Promise<MobileWebSessionCreateResult> {
    return this.requests.request(
      'session',
      'createAgent',
      payload,
      MobileWebSessionCreateAgentPayloadSchema,
      MobileWebSessionCreateResultSchema
    )
  }

  quickCommands(
    payload: MobileWebQuickCommandSnapshotPayload
  ): Promise<MobileWebQuickCommandSnapshotResult> {
    return this.requests.request(
      'session',
      'quickCommands',
      payload,
      MobileWebQuickCommandSnapshotPayloadSchema,
      MobileWebQuickCommandSnapshotResultSchema
    )
  }

  quickCommandMutate(
    payload: MobileWebQuickCommandMutationPayload
  ): Promise<MobileWebQuickCommandSnapshotResult> {
    return this.requests.request(
      'session',
      'quickCommandMutate',
      payload,
      MobileWebQuickCommandMutationPayloadSchema,
      MobileWebQuickCommandSnapshotResultSchema
    )
  }

  createQuickCommand(
    payload: MobileWebQuickCommandLaunchPayload
  ): Promise<MobileWebQuickCommandLaunchResult> {
    return this.requests.request(
      'session',
      'createQuickCommand',
      payload,
      MobileWebQuickCommandLaunchPayloadSchema,
      MobileWebQuickCommandLaunchResultSchema
    )
  }

  createBrowser(
    payload: MobileWebSessionBrowserCreatePayload
  ): Promise<MobileWebSessionBrowserCreateResult> {
    return this.requests.request(
      'session',
      'createBrowser',
      payload,
      MobileWebSessionBrowserCreatePayloadSchema,
      MobileWebSessionBrowserCreateResultSchema
    )
  }

  close(payload: MobileWebSessionTabActionPayload): Promise<MobileWebSessionCloseResult> {
    return this.requests.request(
      'session',
      'close',
      payload,
      MobileWebSessionTabActionPayloadSchema,
      MobileWebSessionCloseResultSchema
    )
  }
}
