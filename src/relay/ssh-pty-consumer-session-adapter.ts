import {
  PTY_CONSUMER_SESSION_PROTOCOL_VERSION,
  PtyConsumerSession,
  type PtyConsumerSessionGrant,
  type PtyConsumerSessionHello
} from '../shared/pty-consumer-session'
import type { RelayClientSessionIdentity, RelayDispatcher, RequestContext } from './dispatcher'

export const SSH_PTY_OPEN_CLIENT_METHOD = 'pty.openClient'

type OpenClientParams = PtyConsumerSessionHello & {
  protocolVersion: number
}

function parseOpenClientParams(params: Record<string, unknown>): OpenClientParams {
  const resume =
    typeof params.resume === 'object' && params.resume !== null
      ? (params.resume as Record<string, unknown>)
      : undefined
  const capabilities =
    typeof params.capabilities === 'object' && params.capabilities !== null
      ? (params.capabilities as Record<string, unknown>)
      : undefined
  const outputFlowControl =
    typeof capabilities?.outputFlowControl === 'object' && capabilities.outputFlowControl !== null
      ? (capabilities.outputFlowControl as Record<string, unknown>)
      : undefined
  return {
    protocolVersion: Number(params.protocolVersion),
    clientInstanceId: String(params.clientInstanceId ?? ''),
    requestedRole: String(params.requestedRole ?? '') as PtyConsumerSessionHello['requestedRole'],
    ...(resume
      ? {
          resume: {
            ownerGeneration: Number(resume.ownerGeneration),
            ownerLease: String(resume.ownerLease ?? '')
          }
        }
      : {}),
    ...(outputFlowControl
      ? {
          capabilities: {
            outputFlowControl: {
              versions: Array.isArray(outputFlowControl.versions)
                ? outputFlowControl.versions.map(Number)
                : [],
              requestedWindowSu: Number(outputFlowControl.requestedWindowSu)
            }
          }
        }
      : {})
  }
}

function requireIdentity(context: RequestContext): RelayClientSessionIdentity {
  if (!context.sessionIdentity) {
    throw new Error('SSH PTY consumer transport identity is unavailable')
  }
  return context.sessionIdentity
}

export class SshPtyConsumerSessionAdapter {
  private readonly session: PtyConsumerSession

  constructor(
    dispatcher: RelayDispatcher,
    serverBuildId: string,
    setDeliveryPaused?: (id: string, paused: boolean) => void
  ) {
    this.session = new PtyConsumerSession({ serverBuildId })
    dispatcher.onRequest(SSH_PTY_OPEN_CLIENT_METHOD, (params, context) =>
      this.openClient(params, context)
    )
    dispatcher.onClientDetached((clientId) => this.session.close(String(clientId)))
    dispatcher.onNotification('pty.setDeliveryPaused', (params, context) => {
      const grant = this.session.activeGrant(String(context.clientId))
      if (
        !grant ||
        grant.clientGeneration !== params.clientGeneration ||
        grant.ownerGeneration !== params.ownerGeneration ||
        typeof params.id !== 'string' ||
        typeof params.paused !== 'boolean'
      ) {
        return
      }
      setDeliveryPaused?.(params.id, params.paused)
    })
  }

  private async openClient(
    rawParams: Record<string, unknown>,
    context: RequestContext
  ): Promise<PtyConsumerSessionGrant> {
    const params = parseOpenClientParams(rawParams)
    if (params.protocolVersion !== PTY_CONSUMER_SESSION_PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported pty.openClient protocol version: ${params.protocolVersion || 'missing'}`
      )
    }
    const identity = requireIdentity(context)
    const admission = this.session.admit(params, {
      connectionId: String(context.clientId),
      principal: identity.principal,
      authenticated: identity.authenticated,
      allowSessionOwner: identity.allowSessionOwner
    })
    if (!context.onResponseSettled) {
      admission.rollbackPublication()
      throw new Error('SSH PTY consumer response publication fence is unavailable')
    }
    context.onResponseSettled((result) => {
      if (result.ok) {
        admission.commitPublication()
      } else {
        admission.rollbackPublication()
      }
    })
    return admission.grant
  }
}
