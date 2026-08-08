import { describe, expect, it } from 'vitest'
import {
  PtyConsumerSession,
  type PtyConsumerSessionHello,
  type PtyConsumerSessionOptions
} from './pty-consumer-session'

const authentication = {
  connectionId: 'connection-1',
  principal: 'desktop',
  authenticated: true,
  allowSessionOwner: true
}

function admit(
  options: Partial<PtyConsumerSessionOptions>,
  capabilities?: PtyConsumerSessionHello['capabilities']
) {
  const session = new PtyConsumerSession({
    serverBuildId: 'relay-build',
    createLease: () => 'lease-1',
    ...options
  })
  return session.admit(
    {
      clientInstanceId: 'client-1',
      requestedRole: 'session-owner',
      ...(capabilities ? { capabilities } : {})
    },
    authentication
  )
}

describe('PTY consumer exact-operation capability', () => {
  it('grants the mutually supported exact-operation version', () => {
    const admission = admit(
      { exactOperations: { versions: [1] } },
      { exactOperations: { versions: [1, 2] } }
    )

    expect(admission.grant.capabilities?.exactOperations).toEqual({ version: 1 })
  })

  it('grants terminal authority outcome delivery only when both peers offer it', () => {
    const admission = admit(
      { terminalAuthorityOutcomeDelivery: { versions: [1] } },
      { terminalAuthorityOutcomeDelivery: { versions: [1, 2] } }
    )

    expect(admission.grant.capabilities?.terminalAuthorityOutcomeDelivery).toEqual({ version: 1 })
    expect(
      admit({ terminalAuthorityOutcomeDelivery: { versions: [1] } }).grant.capabilities
        ?.terminalAuthorityOutcomeDelivery
    ).toBeUndefined()
  })

  it('grants authority exact operations only after an additive mutual offer', () => {
    const admission = admit(
      { terminalAuthorityExactOperations: { versions: [1] } },
      { terminalAuthorityExactOperations: { versions: [1, 2] } }
    )

    expect(admission.grant.capabilities?.terminalAuthorityExactOperations).toEqual({ version: 1 })
    expect(
      admit({ terminalAuthorityExactOperations: { versions: [1] } }).grant.capabilities
        ?.terminalAuthorityExactOperations
    ).toBeUndefined()
  })

  it.each([
    {
      name: 'old client',
      options: { exactOperations: { versions: [1] } },
      capabilities: undefined
    },
    {
      name: 'old relay',
      options: {},
      capabilities: { exactOperations: { versions: [1] } }
    }
  ])('omits exact operations for an $name', ({ options, capabilities }) => {
    const admission = admit(options, capabilities)

    expect(admission.grant.capabilities?.exactOperations).toBeUndefined()
  })

  it('bounds client and relay version offers', () => {
    expect(() =>
      admit(
        { exactOperations: { versions: [1] } },
        { exactOperations: { versions: Array.from({ length: 9 }, (_, index) => index + 1) } }
      )
    ).toThrow('exactOperations.versions')
    expect(
      () =>
        new PtyConsumerSession({
          serverBuildId: 'relay-build',
          exactOperations: { versions: [0] }
        })
    ).toThrow('exactOperations support')
  })
})
