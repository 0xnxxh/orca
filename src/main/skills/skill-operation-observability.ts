import type {
  SkillInstallDestination,
  SkillInstallRequest,
  SkillInstallResult,
  SkillPlacementResult
} from '../../shared/skill-install-contract'
import { startSpan, type ActiveSpan } from '../observability/tracer'
import { skillInstallFailureFromError } from './skill-install-operation-error'

const SAFE_LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export type SkillInstallOperationSpan = {
  complete(result: SkillInstallResult): void
  fail(error: unknown): void
}

function safeLabel(value: string | undefined, fallback: string): string {
  return value && SAFE_LABEL.test(value) ? value : fallback
}

function destinationLabel(destination: SkillInstallDestination): string {
  if (destination.scope === 'workspace') {
    return 'workspace'
  }
  return `global-${destination.executionTarget?.kind ?? 'host'}`
}

function recordPlacement(span: ActiveSpan, placement: SkillPlacementResult): void {
  span.addEvent('skill.placement', {
    provider: safeLabel(placement.provider, 'unknown'),
    topology: placement.topology,
    status: placement.status,
    errorCategory: safeLabel(placement.errorCategory, 'none')
  })
}

export function startSkillInstallOperation(
  request: SkillInstallRequest
): SkillInstallOperationSpan {
  const span = startSpan('skill.install', {
    attributes: {
      packageId: request.package.packageId,
      versionId: request.package.versionId,
      phase: 'install',
      destination: destinationLabel(request.destination),
      transport: request.ingress.kind,
      compressedBytes: request.package.compressedBytes
    }
  })
  return {
    complete(result) {
      span.setAttribute('status', result.status)
      span.setAttribute('placementCount', result.placements.length)
      for (const placement of result.placements) {
        recordPlacement(span, placement)
      }
      if (result.status === 'cancelled') {
        span.interrupt(safeLabel(result.errorCategory, 'skill-install-cancelled'))
      } else if (result.status === 'failed') {
        span.fail(safeLabel(result.errorCategory, 'skill-install-failed'))
      } else {
        span.end()
      }
    },
    fail(error) {
      const failure = skillInstallFailureFromError(error)
      const code = safeLabel(failure?.code, 'skill-install-unknown')
      span.setAttribute('status', failure?.category === 'cancelled' ? 'cancelled' : 'failed')
      if (failure?.category === 'cancelled') {
        span.interrupt(code)
      } else {
        span.fail(code)
      }
    }
  }
}
