import type {
  DeviceResumeConfirmed,
  MobileRelayEndpoint
} from '../../../src/shared/mobile-relay-credential-contract'
import type { RpcApplicationResponsiveness } from './rpc-application-responsiveness'
import type { RpcClient } from './rpc-client'

export type MobileRelayRpcSession = RpcClient & {
  getLeaseExpiresAt(): number | null
  getResumeConfirmation(): DeviceResumeConfirmed | null
  getFailure(): Error | null
}

export type MobileRelayRpcSessionOptions = {
  relay: MobileRelayEndpoint
  resumeToken: string
  resumeCredentialVersion: number
  resumeConfirmReqId: string
  deviceToken: string
  desktopPublicKeyB64: string
  requestTimeoutMs?: number
  createSocket?: (url: string) => WebSocket
  applicationResponsiveness?: RpcApplicationResponsiveness
}
