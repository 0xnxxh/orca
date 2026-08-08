import {
  parseTerminalAuthorityNamespaceOutcomePublication,
  type TerminalAuthorityNamespaceOutcomeBoundary,
  type TerminalAuthorityNamespaceOutcomePublication
} from '../../shared/terminal-session-authority-consumer-transport'
import {
  commitTerminalAuthorityAppOutcomeBoundary,
  requireTerminalAuthorityAppOutcomeBoundary
} from './terminal-authority-app-outcome-boundary'
import type {
  TerminalAuthorityAppOutcomeNamespaceSessionOptions,
  TerminalAuthorityAppOutcomeTiming
} from './terminal-authority-app-outcome-host-contract'
import {
  assertTerminalAuthorityAppOutcomeNamespace,
  requireTerminalAuthorityAppOutcomeConnection,
  type TerminalAuthorityAppNamespaceGeneration
} from './terminal-authority-app-outcome-namespace-state'
import { applyTerminalAuthorityAppOutcomePublication } from './terminal-authority-app-outcome-publication'

type PublicationContext = Readonly<{
  state: TerminalAuthorityAppNamespaceGeneration
  options: TerminalAuthorityAppOutcomeNamespaceSessionOptions
  timing: TerminalAuthorityAppOutcomeTiming
  assertCurrent: (state: TerminalAuthorityAppNamespaceGeneration) => void
  isCurrent: (state: TerminalAuthorityAppNamespaceGeneration) => boolean
  handleGenerationFailure: (state: TerminalAuthorityAppNamespaceGeneration, error: unknown) => void
}>

export function publishTerminalAuthorityAppOutcomeBoundary(
  context: PublicationContext,
  unsafeBoundary: TerminalAuthorityNamespaceOutcomeBoundary
): Promise<void> {
  const { state, options, timing } = context
  let boundary: ReturnType<typeof requireTerminalAuthorityAppOutcomeBoundary>
  try {
    boundary = requireTerminalAuthorityAppOutcomeBoundary(unsafeBoundary)
    context.assertCurrent(state)
    assertTerminalAuthorityAppOutcomeNamespace(options.namespace, boundary.namespace)
  } catch (error) {
    if (context.isCurrent(state)) {
      state.admissionFailure = error instanceof Error ? error : new Error(String(error))
    }
    return Promise.reject(error)
  }
  try {
    return state.work.enqueue('namespace', async () => {
      let acceptance: ReturnType<typeof commitTerminalAuthorityAppOutcomeBoundary>
      try {
        context.assertCurrent(state)
        acceptance = commitTerminalAuthorityAppOutcomeBoundary({
          state,
          boundary,
          identity: requireTerminalAuthorityAppOutcomeConnection(state).expectedConsumer,
          pump: options
        })
      } catch (error) {
        state.admissionFailure = error instanceof Error ? error : new Error(String(error))
        context.handleGenerationFailure(state, error)
        throw error
      }
      try {
        const connection = requireTerminalAuthorityAppOutcomeConnection(state)
        await state.work.settle(
          connection.acceptBoundary(acceptance),
          timing.acknowledgeTimeoutMs,
          'boundary acceptance'
        )
        context.assertCurrent(state)
      } catch (error) {
        context.handleGenerationFailure(state, error)
        throw error
      }
    })
  } catch (error) {
    context.handleGenerationFailure(state, error)
    return Promise.reject(error)
  }
}

export function publishTerminalAuthorityAppOutcome(
  context: PublicationContext,
  unsafePublication: TerminalAuthorityNamespaceOutcomePublication
): Promise<void> {
  const { state, options, timing } = context
  const publication = parseTerminalAuthorityNamespaceOutcomePublication(unsafePublication)
  if (!publication || !context.isCurrent(state)) {
    return Promise.reject(new Error('terminal authority app outcome publication is invalid'))
  }
  try {
    assertTerminalAuthorityAppOutcomeNamespace(options.namespace, publication.namespace)
    return state.work.enqueue('namespace', async () => {
      try {
        await applyTerminalAuthorityAppOutcomePublication(
          state,
          publication,
          options,
          timing.acknowledgeTimeoutMs,
          () => context.assertCurrent(state)
        )
      } catch (error) {
        context.handleGenerationFailure(state, error)
        throw error
      }
    })
  } catch (error) {
    context.handleGenerationFailure(state, error)
    return Promise.reject(error)
  }
}
