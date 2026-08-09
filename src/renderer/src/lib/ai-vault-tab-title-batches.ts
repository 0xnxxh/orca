import { AI_VAULT_SESSION_TITLE_REQUEST_MAX_COUNT } from '../../../shared/ai-vault-session-title'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { AiVaultTitleRequest } from './ai-vault-tab-title-requests'

export function batchAiVaultTitleRequests(
  requests: AiVaultTitleRequest[]
): AiVaultTitleRequest[][] {
  const byHost = new Map<ExecutionHostId, AiVaultTitleRequest[]>()
  for (const request of requests) {
    const hostRequests = byHost.get(request.executionHostId)
    if (hostRequests) {
      hostRequests.push(request)
    } else {
      byHost.set(request.executionHostId, [request])
    }
  }
  const batches: AiVaultTitleRequest[][] = []
  for (const hostRequests of byHost.values()) {
    for (
      let index = 0;
      index < hostRequests.length;
      index += AI_VAULT_SESSION_TITLE_REQUEST_MAX_COUNT
    ) {
      batches.push(hostRequests.slice(index, index + AI_VAULT_SESSION_TITLE_REQUEST_MAX_COUNT))
    }
  }
  return batches
}
