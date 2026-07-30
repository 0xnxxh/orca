import { describe, expect, it, vi } from 'vitest'
import type { TelemetryObservabilityStartupCapability } from './telemetry-observability-startup-capability'
import {
  getTelemetryObservabilityStartupCapability,
  getTelemetryObservabilityStartupCapabilityIfInstalled,
  installTelemetryObservabilityStartupCapability
} from './telemetry-observability-startup-owner'

describe('telemetry/observability startup owner', () => {
  it('fails closed for live consumers and exposes a safe optional quit path', () => {
    expect(getTelemetryObservabilityStartupCapabilityIfInstalled()).toBeNull()
    expect(() => getTelemetryObservabilityStartupCapability()).toThrow(
      'Telemetry/observability capability must be initialized before use'
    )
    const capability = {
      track: vi.fn(),
      shutdownTelemetry: vi.fn(),
      shutdownObservability: vi.fn()
    } as unknown as TelemetryObservabilityStartupCapability

    installTelemetryObservabilityStartupCapability(capability)

    expect(getTelemetryObservabilityStartupCapability()).toBe(capability)
    expect(getTelemetryObservabilityStartupCapabilityIfInstalled()).toBe(capability)
  })
})
