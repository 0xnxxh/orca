import {
  MobileWebTaskGitHubDetailPayloadSchema,
  MobileWebTaskGitHubDetailResultSchema,
  MobileWebTaskGitHubLabelsPayloadSchema,
  MobileWebTaskGitHubLabelsResultSchema,
  MobileWebTaskGitHubUsersPayloadSchema,
  MobileWebTaskGitHubUsersResultSchema,
  MobileWebTaskGitLabDetailPayloadSchema,
  MobileWebTaskGitLabDetailResultSchema,
  MobileWebTaskLinearDetailPayloadSchema,
  MobileWebTaskLinearDetailResultSchema,
  type MobileWebTaskGitHubDetailPayload,
  type MobileWebTaskLinearDetailPayload
} from '../../shared/mobile-web/task-detail-contract'
import {
  MobileWebTaskBootstrapPayloadSchema,
  MobileWebTaskBootstrapResultSchema,
  MobileWebTaskLinearContextPayloadSchema,
  MobileWebTaskLinearContextResultSchema,
  MobileWebTaskPreferenceUpdateResultSchema,
  MobileWebTaskRepoPayloadSchema,
  MobileWebTaskRepositoriesPayloadSchema,
  MobileWebTaskRepositoriesResultSchema,
  MobileWebTaskRepoSlugResultSchema,
  MobileWebTaskResumeUpdatePayloadSchema,
  MobileWebTaskSettingsUpdatePayloadSchema,
  type MobileWebTaskBootstrapResult,
  type MobileWebTaskLinearContextResult,
  type MobileWebTaskRepositoriesResult,
  type MobileWebTaskRepoPayload,
  type MobileWebTaskRepoSlugResult,
  type MobileWebTaskResumeUpdatePayload,
  type MobileWebTaskSettingsUpdatePayload
} from '../../shared/mobile-web/task-read-contract'
import {
  MobileWebTaskGitHubCountPayloadSchema,
  MobileWebTaskGitHubCountResultSchema,
  MobileWebTaskGitHubListPayloadSchema,
  MobileWebTaskGitHubListResultSchema,
  MobileWebTaskGitLabListPayloadSchema,
  MobileWebTaskGitLabListResultSchema,
  MobileWebTaskGitLabTodosPayloadSchema,
  MobileWebTaskGitLabTodosResultSchema,
  MobileWebTaskLinearListPayloadSchema,
  MobileWebTaskLinearListResultSchema,
  type MobileWebTaskGitHubCountPayload,
  type MobileWebTaskGitHubListPayload,
  type MobileWebTaskGitLabListPayload,
  type MobileWebTaskGitLabTodosPayload,
  type MobileWebTaskLinearListPayload
} from '../../shared/mobile-web/task-list-contract'
import type { MobileWebOneShotRequestClient } from './mobile-web-one-shot-request-client'
import { MobileWebTaskProviderRequestClient } from './mobile-web-task-provider-request-client'

export class MobileWebTaskRequestClient extends MobileWebTaskProviderRequestClient {
  constructor(requests: MobileWebOneShotRequestClient) {
    super(requests)
  }

  bootstrap(): Promise<MobileWebTaskBootstrapResult> {
    return this.requests.request(
      'task',
      'bootstrap',
      {},
      MobileWebTaskBootstrapPayloadSchema,
      MobileWebTaskBootstrapResultSchema
    )
  }

  repositories(): Promise<MobileWebTaskRepositoriesResult> {
    return this.requests.request(
      'task',
      'repositories',
      {},
      MobileWebTaskRepositoriesPayloadSchema,
      MobileWebTaskRepositoriesResultSchema
    )
  }

  linearContext(): Promise<MobileWebTaskLinearContextResult> {
    return this.requests.request(
      'task',
      'linearContext',
      {},
      MobileWebTaskLinearContextPayloadSchema,
      MobileWebTaskLinearContextResultSchema
    )
  }

  resolveRepoSlug(payload: MobileWebTaskRepoPayload): Promise<MobileWebTaskRepoSlugResult> {
    return this.requests.request(
      'task',
      'resolveRepoSlug',
      payload,
      MobileWebTaskRepoPayloadSchema,
      MobileWebTaskRepoSlugResultSchema
    )
  }

  updateResume(payload: MobileWebTaskResumeUpdatePayload): Promise<null> {
    return this.requests.request(
      'task',
      'updateResume',
      payload,
      MobileWebTaskResumeUpdatePayloadSchema,
      MobileWebTaskPreferenceUpdateResultSchema
    )
  }

  updateSettings(payload: MobileWebTaskSettingsUpdatePayload): Promise<null> {
    return this.requests.request(
      'task',
      'updateSettings',
      payload,
      MobileWebTaskSettingsUpdatePayloadSchema,
      MobileWebTaskPreferenceUpdateResultSchema
    )
  }

  listGitHub(payload: MobileWebTaskGitHubListPayload) {
    return this.requests.request(
      'task',
      'listGitHub',
      payload,
      MobileWebTaskGitHubListPayloadSchema,
      MobileWebTaskGitHubListResultSchema
    )
  }

  countGitHub(payload: MobileWebTaskGitHubCountPayload) {
    return this.requests.request(
      'task',
      'countGitHub',
      payload,
      MobileWebTaskGitHubCountPayloadSchema,
      MobileWebTaskGitHubCountResultSchema
    )
  }

  listGitLab(payload: MobileWebTaskGitLabListPayload) {
    return this.requests.request(
      'task',
      'listGitLab',
      payload,
      MobileWebTaskGitLabListPayloadSchema,
      MobileWebTaskGitLabListResultSchema
    )
  }

  listGitLabTodos(payload: MobileWebTaskGitLabTodosPayload) {
    return this.requests.request(
      'task',
      'listGitLabTodos',
      payload,
      MobileWebTaskGitLabTodosPayloadSchema,
      MobileWebTaskGitLabTodosResultSchema
    )
  }

  listLinear(payload: MobileWebTaskLinearListPayload) {
    return this.requests.request(
      'task',
      'listLinear',
      payload,
      MobileWebTaskLinearListPayloadSchema,
      MobileWebTaskLinearListResultSchema
    )
  }

  listGitHubLabels(payload: { repoId: string }) {
    return this.requests.request(
      'task',
      'listGitHubLabels',
      payload,
      MobileWebTaskGitHubLabelsPayloadSchema,
      MobileWebTaskGitHubLabelsResultSchema
    )
  }

  listGitHubAssignableUsers(payload: { repoId: string }) {
    return this.requests.request(
      'task',
      'listGitHubAssignableUsers',
      payload,
      MobileWebTaskGitHubUsersPayloadSchema,
      MobileWebTaskGitHubUsersResultSchema
    )
  }

  loadGitHubDetail(payload: MobileWebTaskGitHubDetailPayload) {
    return this.requests.request(
      'task',
      'loadGitHubDetail',
      payload,
      MobileWebTaskGitHubDetailPayloadSchema,
      MobileWebTaskGitHubDetailResultSchema
    )
  }

  loadGitLabDetail(payload: { targetId: string }) {
    return this.requests.request(
      'task',
      'loadGitLabDetail',
      payload,
      MobileWebTaskGitLabDetailPayloadSchema,
      MobileWebTaskGitLabDetailResultSchema
    )
  }

  loadLinearDetail(payload: MobileWebTaskLinearDetailPayload) {
    return this.requests.request(
      'task',
      'loadLinearDetail',
      payload,
      MobileWebTaskLinearDetailPayloadSchema,
      MobileWebTaskLinearDetailResultSchema
    )
  }
}
