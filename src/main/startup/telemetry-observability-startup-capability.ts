import { initObservability, shutdownObservability } from '../observability'
import { classifyError } from '../telemetry/classify-error'
import { initTelemetry, shutdownTelemetry, track, trackAppOpenedOnce } from '../telemetry/client'
import { initCohortClassifier } from '../telemetry/cohort-classifier'
import { resolveConsent } from '../telemetry/consent'
import { initOnboardingCohortClassifier } from '../telemetry/onboarding-cohort-classifier'

export type TelemetryObservabilityStartupCapability = {
  classifyError: typeof classifyError
  initCohortClassifier: typeof initCohortClassifier
  initObservability: typeof initObservability
  initOnboardingCohortClassifier: typeof initOnboardingCohortClassifier
  initTelemetry: typeof initTelemetry
  resolveConsent: typeof resolveConsent
  shutdownObservability: typeof shutdownObservability
  shutdownTelemetry: typeof shutdownTelemetry
  track: typeof track
  trackAppOpenedOnce: typeof trackAppOpenedOnce
}

export function createTelemetryObservabilityStartupCapability(): TelemetryObservabilityStartupCapability {
  return {
    classifyError,
    initCohortClassifier,
    initObservability,
    initOnboardingCohortClassifier,
    initTelemetry,
    resolveConsent,
    shutdownObservability,
    shutdownTelemetry,
    track,
    trackAppOpenedOnce
  }
}
