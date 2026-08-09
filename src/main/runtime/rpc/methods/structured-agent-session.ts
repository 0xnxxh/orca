// `agentSession.*` — the structured session RPC surface.
//
// Every method here is gated on the client advertising
// `agent-session.structured.v1`. A client that does not is told the surface does
// not exist rather than being handed a session it cannot render or drive; that
// is the whole visibility rule, because nothing else on the runtime publishes a
// structured session.

import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import type {
  StructuredAgentSessionCaller,
  StructuredAgentSessionHost
} from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod, type RpcContext } from '../core'
import {
  AttachParams,
  CancelParams,
  HistoryParams,
  RespondParams,
  SendParams,
  SetOptionParams,
  SubscribeParams,
  UnsubscribeParams
} from './structured-agent-session-schemas'

const SUBSCRIPTION_PREFIX = 'agentSession'

/**
 * In-process callers are the same build as the host, so they carry no negotiated
 * capability list; every remote client must say it can read structured sessions.
 */
function supportsStructuredSessions(ctx: RpcContext): boolean {
  return (
    ctx.clientKind === undefined ||
    (ctx.clientCapabilities?.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY) ?? false)
  )
}

function requireHost(ctx: RpcContext): StructuredAgentSessionHost {
  const host = supportsStructuredSessions(ctx) ? getStructuredAgentSessionHost() : null
  if (!host) {
    throw new Error('structured_agent_session_unsupported')
  }
  return host
}

/** Mirrors the existing agent-session host-authority derivation so one client
 *  gets one operation namespace across both surfaces. */
function callerFor(ctx: RpcContext): StructuredAgentSessionCaller {
  return {
    callerKey: ctx.clientId?.trim() || `trusted-local:${ctx.clientKind ?? 'runtime'}`
  }
}

function subscriptionIdFor(ctx: RpcContext, sessionId: string): string {
  const base = `${SUBSCRIPTION_PREFIX}:${ctx.connectionId ?? 'local'}:${sessionId}`
  // Shared control multiplexes several streams over one socket; the frame id
  // keeps one subscriber from evicting another on the same session.
  return ctx.requestId ? `${base}:${ctx.requestId}` : base
}

export const STRUCTURED_AGENT_SESSION_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'agentSession.create',
    params: AttachParams,
    handler: async (params, ctx) => {
      if (params.envelope.expectedRuntimeFence !== null) {
        throw new Error('agent_session_operation_invalid')
      }
      return requireHost(ctx).attach(callerFor(ctx), params)
    }
  }),
  defineMethod({
    name: 'agentSession.ensure',
    params: AttachParams,
    handler: async (params, ctx) => requireHost(ctx).attach(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.send',
    params: SendParams,
    handler: async (params, ctx) => requireHost(ctx).send(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.cancel',
    params: CancelParams,
    handler: async (params, ctx) => requireHost(ctx).cancel(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.respondToApproval',
    params: RespondParams,
    handler: async (params, ctx) =>
      requireHost(ctx).respondToPrompt(callerFor(ctx), { ...params, kind: 'approval' })
  }),
  defineMethod({
    name: 'agentSession.respondToQuestion',
    params: RespondParams,
    handler: async (params, ctx) =>
      requireHost(ctx).respondToPrompt(callerFor(ctx), { ...params, kind: 'question' })
  }),
  defineMethod({
    name: 'agentSession.setOption',
    params: SetOptionParams,
    handler: async (params, ctx) => requireHost(ctx).setOption(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.history',
    params: HistoryParams,
    handler: async (params, ctx) => requireHost(ctx).history(params)
  }),
  defineStreamingMethod({
    name: 'agentSession.subscribe',
    params: SubscribeParams,
    handler: async (params, ctx, emit) => {
      const host = requireHost(ctx)
      const subscriptionId = subscriptionIdFor(ctx, params.sessionId)
      let closed = false
      let dispose = (): void => {}
      ctx.runtime.registerSubscriptionCleanup(
        subscriptionId,
        () => {
          closed = true
          dispose()
        },
        ctx.connectionId
      )
      if (closed) {
        return
      }
      // The host emits the opening snapshot (or the missed batch) synchronously
      // inside open(), so nothing between here and there can interleave.
      dispose = host.subscribe({
        id: subscriptionId,
        sessionId: params.sessionId,
        emit,
        ...(params.cursor ? { cursor: params.cursor } : {})
      })
      if (closed) {
        dispose()
      }
    }
  }),
  defineMethod({
    name: 'agentSession.unsubscribe',
    params: UnsubscribeParams,
    handler: async (params, ctx) => {
      requireHost(ctx)
      const connection = ctx.connectionId ?? 'local'
      const base = `${SUBSCRIPTION_PREFIX}:${connection}:${params.sessionId}`
      if (params.subscriptionId) {
        ctx.runtime.cleanupSubscription(`${base}:${params.subscriptionId}`)
        return { unsubscribed: true }
      }
      ctx.runtime.cleanupSubscription(base)
      ctx.runtime.cleanupSubscriptionsByPrefix(`${base}:`)
      return { unsubscribed: true }
    }
  })
]
