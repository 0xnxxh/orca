import { z } from 'zod'
import {
  MOBILE_WEB_BRIDGE_MAX_GRANTS,
  MOBILE_WEB_BRIDGE_MAX_MESSAGE_BYTES,
  MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES,
  MOBILE_WEB_BRIDGE_MAX_PENDING_REQUESTS
} from './bridge-limits'
import { MOBILE_WEB_BRIDGE_PROTOCOL_VERSION } from './bridge-protocol-version'
import {
  isMobileWebBridgeOperation,
  MobileWebBridgeCapabilitySchema,
  type MobileWebBridgeCapability
} from './bridge-operation-registry'
import { MobileWebWorkspaceIdSchema } from './workspace-operation-contract'

export {
  isMobileWebBridgeOperation,
  MOBILE_WEB_BRIDGE_OPERATIONS
} from './bridge-operation-registry'
export type { MobileWebBridgeCapability } from './bridge-operation-registry'
export {
  MOBILE_WEB_BRIDGE_ENVELOPE_RESERVE_BYTES,
  MOBILE_WEB_BRIDGE_MAX_GRANTS,
  MOBILE_WEB_BRIDGE_MAX_MESSAGE_BYTES,
  MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES,
  MOBILE_WEB_BRIDGE_MAX_PENDING_REQUESTS,
  MOBILE_WEB_BRIDGE_MAX_SUBSCRIPTIONS
} from './bridge-limits'
export { MOBILE_WEB_BRIDGE_PROTOCOL_VERSION } from './bridge-protocol-version'

const BUILD_ID_PATTERN = /^[a-f0-9]{64}$/
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

const MobileWebBridgeOperationShape = {
  capability: MobileWebBridgeCapabilitySchema,
  operation: z.string().min(1).max(40)
} as const

export const MobileWebBridgeErrorCodeSchema = z.enum([
  'invalid_message',
  'too_large',
  'unsupported_version',
  'stale_session',
  'unsupported_capability',
  'invalid_request',
  'rate_limited',
  'permission_required',
  'user_cancelled',
  'not_connected',
  'not_found',
  'conflict',
  'timeout',
  'cancelled',
  'host_error',
  'unavailable',
  'internal'
])

const ShellSessionIdSchema = z.string().regex(SESSION_ID_PATTERN)
const BuildIdSchema = z.string().regex(BUILD_ID_PATTERN)
const RequestIdSchema = z.string().regex(MESSAGE_ID_PATTERN)
const SubscriptionIdSchema = z.string().regex(MESSAGE_ID_PATTERN)
const SequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const PageEnvelopeSchema = z.object({
  version: z.literal(MOBILE_WEB_BRIDGE_PROTOCOL_VERSION),
  shellSessionId: ShellSessionIdSchema,
  buildId: BuildIdSchema
})

const PageReadySchema = PageEnvelopeSchema.extend({ type: z.literal('ready') }).strict()

const PageHealthSchema = PageEnvelopeSchema.extend({
  type: z.literal('health'),
  state: z.literal('interactive')
}).strict()

export const MobileWebResumeRouteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspaceList') }).strict(),
  z
    .object({
      kind: z.literal('session'),
      workspaceId: MobileWebWorkspaceIdSchema,
      workspaceName: z.string().max(240)
    })
    .strict()
])

const PageRouteStateSchema = PageEnvelopeSchema.extend({
  type: z.literal('routeState'),
  route: MobileWebResumeRouteSchema
}).strict()

const PageOneShotRequestSchema = PageEnvelopeSchema.extend({
  type: z.literal('request'),
  mode: z.literal('once'),
  requestId: RequestIdSchema,
  capability: MobileWebBridgeCapabilitySchema,
  operation: z.string().min(1).max(40),
  payload: z.unknown()
})
  .strict()
  .superRefine(validateRequestOperation)

const PageSubscriptionRequestSchema = PageEnvelopeSchema.extend({
  type: z.literal('request'),
  mode: z.literal('subscription'),
  requestId: RequestIdSchema,
  subscriptionId: SubscriptionIdSchema,
  capability: MobileWebBridgeCapabilitySchema,
  operation: z.string().min(1).max(40),
  payload: z.unknown()
})
  .strict()
  .superRefine(validateSubscriptionRequest)

const PageCancelSchema = PageEnvelopeSchema.extend({
  type: z.literal('cancel'),
  target: z.enum(['request', 'subscription']),
  id: RequestIdSchema
}).strict()

export const MobileWebBridgePageMessageSchema = z.union([
  PageReadySchema,
  PageHealthSchema,
  PageRouteStateSchema,
  PageOneShotRequestSchema,
  PageSubscriptionRequestSchema,
  PageCancelSchema
])

const OperationLimitsSchema = z
  .object({
    maxRequestBytes: z.number().int().positive().max(MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES),
    maxResponseBytes: z.number().int().positive().max(MOBILE_WEB_BRIDGE_MAX_OPERATION_BYTES),
    maxConcurrent: z.number().int().positive().max(MOBILE_WEB_BRIDGE_MAX_PENDING_REQUESTS),
    rateCapacity: z.number().int().positive().max(1_000),
    rateRefillPerSecond: z.number().positive().max(1_000)
  })
  .strict()

const OperationGrantSchema = z
  .object({ ...MobileWebBridgeOperationShape, limits: OperationLimitsSchema })
  .strict()
  .superRefine(validateRequestOperation)

const ShellEnvelopeSchema = z.object({
  version: z.literal(MOBILE_WEB_BRIDGE_PROTOCOL_VERSION),
  shellSessionId: ShellSessionIdSchema,
  buildId: BuildIdSchema
})

const ConnectionStateSchema = z.enum(['connecting', 'connected', 'offline', 'recovering'])
const ConnectionMetricsShape = {
  reconnectAttempts: z.number().int().nonnegative().max(1_000_000).optional(),
  lastConnectedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional()
} as const

const ShellInitSchema = ShellEnvelopeSchema.extend({
  type: z.literal('init'),
  connection: ConnectionStateSchema,
  grants: z.array(OperationGrantSchema).max(MOBILE_WEB_BRIDGE_MAX_GRANTS),
  resumeRoute: MobileWebResumeRouteSchema.optional(),
  ...ConnectionMetricsShape
})
  .strict()
  .superRefine(validateUniqueGrants)

const ShellConnectionSchema = ShellEnvelopeSchema.extend({
  type: z.literal('connection'),
  state: ConnectionStateSchema,
  ...ConnectionMetricsShape
}).strict()

const ShellNavigationSchema = ShellEnvelopeSchema.extend({
  type: z.literal('navigation'),
  sequence: SequenceSchema,
  route: MobileWebResumeRouteSchema
}).strict()

const ShellSuccessResponseSchema = ShellEnvelopeSchema.extend({
  type: z.literal('response'),
  requestId: RequestIdSchema,
  status: z.literal('success'),
  payload: z.unknown()
}).strict()

const ShellErrorResponseSchema = ShellEnvelopeSchema.extend({
  type: z.literal('response'),
  requestId: RequestIdSchema,
  status: z.literal('error'),
  error: z.object({ code: MobileWebBridgeErrorCodeSchema, retryable: z.boolean() }).strict()
}).strict()

const ShellEventSchema = ShellEnvelopeSchema.extend({
  type: z.literal('event'),
  subscriptionId: SubscriptionIdSchema,
  sequence: SequenceSchema,
  payload: z.unknown()
}).strict()

export const MobileWebBridgeShellMessageSchema = z.union([
  ShellInitSchema,
  ShellConnectionSchema,
  ShellNavigationSchema,
  ShellSuccessResponseSchema,
  ShellErrorResponseSchema,
  ShellEventSchema
])

export type MobileWebBridgeErrorCode = z.infer<typeof MobileWebBridgeErrorCodeSchema>
export type MobileWebBridgePageMessage = z.infer<typeof MobileWebBridgePageMessageSchema>
export type MobileWebBridgeShellMessage = z.infer<typeof MobileWebBridgeShellMessageSchema>
export type MobileWebResumeRoute = z.infer<typeof MobileWebResumeRouteSchema>

export type MobileWebBridgeMessageContext = {
  shellSessionId: string
  buildId: string
}

export type MobileWebBridgeParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MobileWebBridgeErrorCode }

export function parseMobileWebBridgePageMessage(
  raw: string,
  expected: MobileWebBridgeMessageContext
): MobileWebBridgeParseResult<MobileWebBridgePageMessage> {
  return parseBridgeMessage(raw, expected, MobileWebBridgePageMessageSchema)
}

export function parseMobileWebBridgeShellMessage(
  raw: string,
  expected: MobileWebBridgeMessageContext
): MobileWebBridgeParseResult<MobileWebBridgeShellMessage> {
  return parseBridgeMessage(raw, expected, MobileWebBridgeShellMessageSchema)
}

function parseBridgeMessage<T extends MobileWebBridgeMessageContext>(
  raw: string,
  expected: MobileWebBridgeMessageContext,
  schema: z.ZodType<T>
): MobileWebBridgeParseResult<T> {
  if (new TextEncoder().encode(raw).byteLength > MOBILE_WEB_BRIDGE_MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'too_large' }
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'invalid_message' }
  }
  if (
    isRecord(value) &&
    'version' in value &&
    value.version !== MOBILE_WEB_BRIDGE_PROTOCOL_VERSION
  ) {
    return { ok: false, error: 'unsupported_version' }
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: 'invalid_message' }
  }
  if (
    parsed.data.shellSessionId !== expected.shellSessionId ||
    parsed.data.buildId !== expected.buildId
  ) {
    return { ok: false, error: 'stale_session' }
  }
  return { ok: true, value: parsed.data }
}

function validateRequestOperation(
  request: { capability: MobileWebBridgeCapability; operation: string },
  context: z.RefinementCtx
): void {
  if (!isMobileWebBridgeOperation(request.capability, request.operation)) {
    context.addIssue({ code: 'custom', message: 'Unknown capability operation' })
  }
}

function validateSubscriptionRequest(
  request: {
    requestId: string
    subscriptionId: string
    capability: MobileWebBridgeCapability
    operation: string
  },
  context: z.RefinementCtx
): void {
  validateRequestOperation(request, context)
  if (request.requestId === request.subscriptionId) {
    context.addIssue({
      code: 'custom',
      message: 'Request and subscription IDs must be distinct',
      path: ['subscriptionId']
    })
  }
}

function validateUniqueGrants(
  message: { grants: { capability: MobileWebBridgeCapability; operation: string }[] },
  context: z.RefinementCtx
): void {
  const seen = new Set<string>()
  message.grants.forEach((grant, index) => {
    const key = `${grant.capability}.${grant.operation}`
    if (seen.has(key)) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate operation grant',
        path: ['grants', index]
      })
    }
    seen.add(key)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
