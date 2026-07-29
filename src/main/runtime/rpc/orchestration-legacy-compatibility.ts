import type { RpcRequest } from './core'
import type { OrcaRuntimeService } from '../orca-runtime'
import { LegacyCompatibilityAuthority } from './orchestration-legacy-authority'
import { handleLegacyLifecycleSend } from './orchestration-legacy-lifecycle'
import { handleLegacyCheck, handleLegacyReply } from './orchestration-legacy-mail'
import { handleLegacyAsk } from './orchestration-legacy-question'
import type {
  LegacyAskParams,
  LegacyCheckParams,
  LegacyReplyParams,
  LegacySendParams
} from './orchestration-legacy-operation'

const COORDINATOR_PREFLIGHT_METHODS = new Set([
  'orchestration.taskCreate',
  'orchestration.taskList',
  'orchestration.taskUpdate',
  'orchestration.dispatch',
  'orchestration.gateCreate',
  'orchestration.gateResolve',
  'orchestration.runUse',
  'orchestration.check',
  'orchestration.reply'
])

export type LegacyCompatibilityRoute =
  | { handled: true; result: unknown }
  | { handled: false; params?: unknown; legacyCoordinatorRunId?: string }

export class OrchestrationLegacyCompatibility {
  private readonly authority: LegacyCompatibilityAuthority

  constructor(private readonly runtime: OrcaRuntimeService) {
    this.authority = new LegacyCompatibilityAuthority(runtime)
  }

  async tryHandle(
    request: RpcRequest,
    params: unknown,
    signal?: AbortSignal
  ): Promise<LegacyCompatibilityRoute> {
    if (!request.method.startsWith('orchestration.')) {
      return { handled: false }
    }
    const result = await this.route(request, params, signal)
    if (result !== undefined) {
      return { handled: true, result }
    }
    if (!COORDINATOR_PREFLIGHT_METHODS.has(request.method)) {
      return { handled: false }
    }
    const values = params as Record<string, unknown>
    const requestedRunId =
      request.method === 'orchestration.runUse' ? stringValue(values.id) : stringValue(values.run)
    const runId = this.authority.resolveProvenCoordinatorScope(request, requestedRunId)
    return runId
      ? {
          handled: false,
          params: { ...values, run: runId },
          legacyCoordinatorRunId: runId
        }
      : { handled: false }
  }

  private async route(
    request: RpcRequest,
    params: unknown,
    signal?: AbortSignal
  ): Promise<unknown | undefined> {
    if (request.method === 'orchestration.send') {
      return await handleLegacyLifecycleSend({
        runtime: this.runtime,
        authority: this.authority,
        request,
        params: params as LegacySendParams
      })
    }
    if (request.method === 'orchestration.check') {
      return await handleLegacyCheck({
        runtime: this.runtime,
        authority: this.authority,
        request,
        params: params as LegacyCheckParams,
        signal
      })
    }
    if (request.method === 'orchestration.ask') {
      return await handleLegacyAsk({
        runtime: this.runtime,
        authority: this.authority,
        request,
        params: params as LegacyAskParams,
        signal
      })
    }
    if (request.method === 'orchestration.reply') {
      return await handleLegacyReply({
        runtime: this.runtime,
        authority: this.authority,
        request,
        params: params as LegacyReplyParams
      })
    }
    return undefined
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
