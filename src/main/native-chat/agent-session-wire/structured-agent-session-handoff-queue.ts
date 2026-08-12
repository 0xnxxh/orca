import type {
  AgentSessionHandoffRequest,
  AgentSessionHandoffStatus
} from '../../../shared/agent-session-wire'
import { activeStructuredAgentSessionTurnId } from '../../../shared/structured-agent-session-projection'
import type {
  StructuredAgentSessionHandoffDeps,
  StructuredTuiOwner
} from './structured-agent-session-handoff-types'

export class StructuredAgentSessionHandoffQueue {
  private readonly controllers = new Map<string, AbortController>()

  cancel(sessionId: string): void {
    this.controllers.get(sessionId)?.abort()
    this.controllers.delete(sessionId)
  }

  enqueue(
    sessionId: string,
    isIdle: (signal: AbortSignal) => boolean | Promise<boolean>,
    onReady: () => void
  ): void {
    this.cancel(sessionId)
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    void this.waitUntilIdle(sessionId, controller, isIdle).then((ready) => {
      if (ready) {
        onReady()
      }
    })
  }

  private async waitUntilIdle(
    sessionId: string,
    controller: AbortController,
    isIdle: (signal: AbortSignal) => boolean | Promise<boolean>
  ): Promise<boolean> {
    while (this.controllers.get(sessionId) === controller && !controller.signal.aborted) {
      try {
        if (await isIdle(controller.signal)) {
          this.controllers.delete(sessionId)
          return true
        }
      } catch {
        if (controller.signal.aborted) {
          return false
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return false
  }
}

export function enqueueStructuredHandoffAfterTurn(input: {
  deps: StructuredAgentSessionHandoffDeps
  queue: StructuredAgentSessionHandoffQueue
  params: AgentSessionHandoffRequest
  tuiOwner: StructuredTuiOwner | undefined
  setStatus: (status: AgentSessionHandoffStatus) => void
  begin: (params: AgentSessionHandoffRequest, tuiAlreadyExited: boolean) => void
}): void {
  const { deps, params, queue, tuiOwner } = input
  const sessionId = params.envelope.sessionId
  let tuiReadiness: 'idle' | 'exited' | null = null
  input.setStatus({
    owner: params.direction === 'to-tui' ? 'native' : 'tui',
    direction: params.direction,
    phase: 'queued',
    stage: null,
    operationId: params.envelope.clientOperationId,
    hostLabel: deps.transport?.hostLabel
  })
  queue.enqueue(
    sessionId,
    async (signal) => {
      if (params.direction === 'to-tui') {
        return !activeStructuredAgentSessionTurnId(deps.session(sessionId).journal.snapshot().items)
      }
      tuiReadiness = tuiOwner
        ? ((await deps.transport?.waitForTuiIdleOrExit(tuiOwner, signal)) ?? null)
        : null
      return tuiReadiness !== null
    },
    () => input.begin({ ...params, mode: 'now' }, tuiReadiness === 'exited')
  )
}
