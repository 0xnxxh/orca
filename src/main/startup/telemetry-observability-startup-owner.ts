import type { TelemetryObservabilityStartupCapability } from './telemetry-observability-startup-capability'

let capability: TelemetryObservabilityStartupCapability | null = null

export function installTelemetryObservabilityStartupCapability(
  nextCapability: TelemetryObservabilityStartupCapability
): void {
  capability = nextCapability
}

export function getTelemetryObservabilityStartupCapability(): TelemetryObservabilityStartupCapability {
  if (!capability) {
    throw new Error('Telemetry/observability capability must be initialized before use')
  }
  return capability
}

export function getTelemetryObservabilityStartupCapabilityIfInstalled(): TelemetryObservabilityStartupCapability | null {
  return capability
}
