import type { AgentSessionHandoffRequest } from '../../../shared/agent-session-wire'
import { stopStructuredNativeTurn } from './structured-agent-session-handoff-flow-context'
import { handoffStructuredSessionToTui } from './structured-agent-session-handoff-forward'
import type { StructuredAgentSessionHandoffOperationGuard } from './structured-agent-session-handoff-operation-guard'
import { handoffStructuredSessionToNative } from './structured-agent-session-handoff-reverse'
import type {
  StructuredAgentSessionHandoffDeps,
  StructuredAgentSessionHandoffFlowContext
} from './structured-agent-session-handoff-types'

export class StructuredAgentSessionHandoffFlowRunner {
  private readonly active = new Set<Promise<void>>()

  constructor(
    private readonly input: {
      deps: StructuredAgentSessionHandoffDeps
      operationGuard: StructuredAgentSessionHandoffOperationGuard
      flowContext: () => StructuredAgentSessionHandoffFlowContext
      fail: (params: AgentSessionHandoffRequest, error: unknown) => void
    }
  ) {}

  async drain(): Promise<void> {
    await Promise.allSettled(this.active)
  }

  track(task: Promise<void>): void {
    this.active.add(task)
    void task.finally(() => this.active.delete(task))
  }

  begin(input: {
    callerKey: string
    params: AgentSessionHandoffRequest
    turnId: string | null
    fingerprint: string
    tuiAlreadyExited?: boolean
  }): void {
    const { callerKey, params, turnId, fingerprint, tuiAlreadyExited = false } = input
    const sessionId = params.envelope.sessionId
    this.input.operationGuard.start(sessionId, {
      callerKey,
      operationId: params.envelope.clientOperationId,
      fingerprint
    })
    const flow = this.run(params, turnId, tuiAlreadyExited)
      .then(() =>
        this.input.deps.store.recordOperationOutcome({
          callerKey,
          operationId: params.envelope.clientOperationId,
          outcome: { status: 'succeeded', sessionId }
        })
      )
      .catch(async (error) => {
        await this.input.deps.store.recordOperationOutcome({
          callerKey,
          operationId: params.envelope.clientOperationId,
          outcome: { status: 'failed', code: 'agent_session_handoff_failed' }
        })
        this.input.fail(params, error)
      })
      .finally(() => this.input.operationGuard.finish(sessionId, params.envelope.clientOperationId))
    this.track(flow)
  }

  private run(
    params: AgentSessionHandoffRequest,
    turnId: string | null,
    tuiAlreadyExited: boolean
  ): Promise<void> {
    const sessionId = params.envelope.sessionId
    return this.input.deps.schedule(sessionId, async () => {
      if (turnId && params.mode === 'stop-turn') {
        const stopped = await stopStructuredNativeTurn(this.input.deps, sessionId, turnId)
        if (!stopped) {
          throw new Error('The current turn did not acknowledge cancellation.')
        }
      }
      await (params.direction === 'to-tui'
        ? handoffStructuredSessionToTui(this.input.flowContext(), params, params.action === 'retry')
        : handoffStructuredSessionToNative(
            this.input.flowContext(),
            params,
            params.action === 'retry',
            tuiAlreadyExited
          ))
    })
  }
}
