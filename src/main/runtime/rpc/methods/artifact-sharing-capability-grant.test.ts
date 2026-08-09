import { describe, expect, it } from 'vitest'
import { SettingsUpdate } from './client-ui-schemas'

// Why: the publish gate is only real if an agent cannot grant it to itself. The RPC settings
// surface — which the CLI, relay, and mobile clients all reach — must reject the key outright.
describe('artifact publish capability cannot be granted over RPC', () => {
  it('rejects settings.update attempts to turn on artifactSharingEnabled', () => {
    expect(SettingsUpdate.safeParse({ artifactSharingEnabled: true }).success).toBe(false)
  })

  it('rejects the deprecated artifactsEnabled alias too', () => {
    expect(SettingsUpdate.safeParse({ artifactsEnabled: true }).success).toBe(false)
  })

  it('still accepts an unrelated allowlisted setting', () => {
    expect(SettingsUpdate.safeParse({ compactWorktreeCards: true }).success).toBe(true)
  })
})
