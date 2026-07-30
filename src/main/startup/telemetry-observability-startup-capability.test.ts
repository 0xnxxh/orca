import { describe, expect, it, vi } from 'vitest'

const telemetryMocks = vi.hoisted(() => ({
  classifyError: vi.fn(),
  initCohortClassifier: vi.fn(),
  initObservability: vi.fn(),
  initOnboardingCohortClassifier: vi.fn(),
  initTelemetry: vi.fn(),
  resolveConsent: vi.fn(),
  shutdownObservability: vi.fn(),
  shutdownTelemetry: vi.fn(),
  track: vi.fn(),
  trackAppOpenedOnce: vi.fn()
}))

vi.mock('../observability', () => ({
  initObservability: telemetryMocks.initObservability,
  shutdownObservability: telemetryMocks.shutdownObservability
}))
vi.mock('../telemetry/classify-error', () => ({
  classifyError: telemetryMocks.classifyError
}))
vi.mock('../telemetry/client', () => ({
  initTelemetry: telemetryMocks.initTelemetry,
  shutdownTelemetry: telemetryMocks.shutdownTelemetry,
  track: telemetryMocks.track,
  trackAppOpenedOnce: telemetryMocks.trackAppOpenedOnce
}))
vi.mock('../telemetry/cohort-classifier', () => ({
  initCohortClassifier: telemetryMocks.initCohortClassifier
}))
vi.mock('../telemetry/consent', () => ({
  resolveConsent: telemetryMocks.resolveConsent
}))
vi.mock('../telemetry/onboarding-cohort-classifier', () => ({
  initOnboardingCohortClassifier: telemetryMocks.initOnboardingCohortClassifier
}))

import { createTelemetryObservabilityStartupCapability } from './telemetry-observability-startup-capability'

describe('telemetry/observability startup capability', () => {
  it('returns every original function identity', () => {
    expect(createTelemetryObservabilityStartupCapability()).toEqual(telemetryMocks)
  })
})
