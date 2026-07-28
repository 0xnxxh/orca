import { describe, expect, it } from 'vitest'
import {
  MobileWebSessionAgentOptionsResultSchema,
  MobileWebSessionCapabilitiesPayloadSchema,
  MobileWebSessionCapabilitiesResultSchema,
  MobileWebSessionCreateAgentPayloadSchema
} from './session-operation-contract'

describe('mobile web session operation contract', () => {
  it('keeps the runtime-capability request and boolean projection strict', () => {
    expect(MobileWebSessionCapabilitiesPayloadSchema.safeParse({}).success).toBe(true)
    expect(
      MobileWebSessionCapabilitiesPayloadSchema.safeParse({ capabilities: ['secret.v1'] }).success
    ).toBe(false)

    const projection = {
      browserScreencastSupported: true,
      agentHistorySupported: true,
      quickCommandsSupported: false,
      terminalQueryReplyInputSupported: true
    }
    expect(MobileWebSessionCapabilitiesResultSchema.parse(projection)).toEqual(projection)
    expect(
      MobileWebSessionCapabilitiesResultSchema.safeParse({
        ...projection,
        capabilities: ['secret.v1']
      }).success
    ).toBe(false)
  })

  it('accepts only known agents in bounded option and create payloads', () => {
    expect(
      MobileWebSessionAgentOptionsResultSchema.parse({
        agents: ['codex', 'claude']
      })
    ).toEqual({ agents: ['codex', 'claude'] })
    expect(
      MobileWebSessionAgentOptionsResultSchema.safeParse({
        agents: ['not an agent']
      }).success
    ).toBe(false)
    expect(
      MobileWebSessionCreateAgentPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        agent: 'codex'
      }).success
    ).toBe(true)
    expect(
      MobileWebSessionCreateAgentPayloadSchema.safeParse({
        workspaceId: 'workspace-1',
        agent: 'not an agent'
      }).success
    ).toBe(false)
  })
})
