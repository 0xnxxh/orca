import { toast } from 'sonner'
import type { AiVaultSession } from '../../../shared/ai-vault-types'
import { activateAndRevealWorktree } from './worktree-activation'
import { activateStructuredAgentSessionById } from './structured-agent-session-tab-activation'
import { useAppStore } from '@/store'

export function activateAiVaultStructuredSession(session: AiVaultSession): boolean {
  const structured = session.structuredSession
  if (!structured) {
    return false
  }
  if (
    !activateStructuredAgentSessionById({
      worktreeId: structured.workspaceId,
      sessionId: structured.sessionId
    })
  ) {
    toast.error('The structured agent session is not available yet. Retry in a moment.')
    return true
  }
  if (useAppStore.getState().activeWorktreeId !== structured.workspaceId) {
    activateAndRevealWorktree(structured.workspaceId)
  }
  return true
}
