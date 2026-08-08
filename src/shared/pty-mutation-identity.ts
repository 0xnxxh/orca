import { isPtyIncarnationId, type PtyIncarnationId } from './pty-incarnation'

export type PtyMutationIdentity = {
  incarnationId: PtyIncarnationId
  paneGeneration?: number
  mutationLeaseId?: string
}

export type PtyMutationClaimant = {
  rendererEpochId: string
  sequence: number
}

export type PtyAdministrativeMutationEvidence = {
  incarnationId: PtyIncarnationId
  paneGeneration?: number
}

export type PtyAdministrativeMutationAccess =
  | { mode: 'legacy'; providerRouteId?: string }
  | {
      mode: 'exact'
      evidence: PtyAdministrativeMutationEvidence
      providerRouteId?: string
    }
  | { mode: 'unavailable'; providerRouteId?: string }

export type PtyMutationAccess =
  | { mode: 'legacy' }
  | { mode: 'exact'; identity: PtyMutationIdentity; claimant: PtyMutationClaimant }
  | { mode: 'unavailable' }

export function parsePtyMutationAccess(value: unknown): PtyMutationAccess | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as { mode?: unknown; identity?: unknown }
  if (candidate.mode === 'legacy' || candidate.mode === 'unavailable') {
    return { mode: candidate.mode }
  }
  if (candidate.mode !== 'exact') {
    return null
  }
  const identity = parsePtyMutationIdentity(candidate.identity)
  const claimant = parsePtyMutationClaimant((candidate as { claimant?: unknown }).claimant)
  return identity?.mutationLeaseId && claimant ? { mode: 'exact', identity, claimant } : null
}

export function parsePtyMutationIdentity(value: unknown): PtyMutationIdentity | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as {
    incarnationId?: unknown
    paneGeneration?: unknown
    mutationLeaseId?: unknown
  }
  if (!isPtyIncarnationId(candidate.incarnationId)) {
    return null
  }
  if (
    candidate.paneGeneration !== undefined &&
    (!Number.isSafeInteger(candidate.paneGeneration) || (candidate.paneGeneration as number) < 0)
  ) {
    return null
  }
  if (
    candidate.mutationLeaseId !== undefined &&
    (typeof candidate.mutationLeaseId !== 'string' ||
      candidate.mutationLeaseId.length === 0 ||
      candidate.mutationLeaseId.length > 128)
  ) {
    return null
  }
  return {
    incarnationId: candidate.incarnationId,
    ...(candidate.paneGeneration !== undefined
      ? { paneGeneration: candidate.paneGeneration as number }
      : {}),
    ...(candidate.mutationLeaseId !== undefined
      ? { mutationLeaseId: candidate.mutationLeaseId }
      : {})
  }
}

export function parsePtyMutationClaimant(value: unknown): PtyMutationClaimant | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as { rendererEpochId?: unknown; sequence?: unknown }
  if (
    typeof candidate.rendererEpochId !== 'string' ||
    candidate.rendererEpochId.length === 0 ||
    candidate.rendererEpochId.length > 128 ||
    !Number.isSafeInteger(candidate.sequence) ||
    (candidate.sequence as number) <= 0
  ) {
    return null
  }
  return {
    rendererEpochId: candidate.rendererEpochId,
    sequence: candidate.sequence as number
  }
}

export function parsePtyAdministrativeMutationEvidence(
  value: unknown
): PtyAdministrativeMutationEvidence | null {
  const identity = parsePtyMutationIdentity(value)
  return identity
    ? {
        incarnationId: identity.incarnationId,
        ...(identity.paneGeneration !== undefined
          ? { paneGeneration: identity.paneGeneration }
          : {})
      }
    : null
}

export function parsePtyAdministrativeMutationAccess(
  value: unknown
): PtyAdministrativeMutationAccess | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as { mode?: unknown; evidence?: unknown; providerRouteId?: unknown }
  if (
    candidate.providerRouteId !== undefined &&
    (typeof candidate.providerRouteId !== 'string' ||
      candidate.providerRouteId.length === 0 ||
      candidate.providerRouteId.length > 128)
  ) {
    return null
  }
  const providerRoute =
    candidate.providerRouteId === undefined
      ? {}
      : { providerRouteId: candidate.providerRouteId as string }
  if (candidate.mode === 'legacy' || candidate.mode === 'unavailable') {
    return { mode: candidate.mode, ...providerRoute }
  }
  const evidence = parsePtyAdministrativeMutationEvidence(candidate.evidence)
  return candidate.mode === 'exact' && evidence
    ? { mode: 'exact', evidence, ...providerRoute }
    : null
}

export function ptyMutationIdentityMatchesAdministrativeEvidence(
  identity: PtyMutationIdentity | undefined,
  evidence: PtyAdministrativeMutationEvidence | null | undefined
): boolean {
  return Boolean(
    identity &&
    evidence &&
    identity.incarnationId === evidence.incarnationId &&
    identity.paneGeneration === evidence.paneGeneration
  )
}

export function toPtyAdministrativeMutationEvidence(
  identity: PtyMutationIdentity
): PtyAdministrativeMutationEvidence {
  return {
    incarnationId: identity.incarnationId,
    ...(identity.paneGeneration !== undefined ? { paneGeneration: identity.paneGeneration } : {})
  }
}

export function ptyMutationIdentitiesEqual(
  left: PtyMutationIdentity | undefined,
  right: PtyMutationIdentity | null
): boolean {
  return Boolean(
    left &&
    right &&
    left.incarnationId === right.incarnationId &&
    left.paneGeneration === right.paneGeneration &&
    left.mutationLeaseId !== undefined &&
    left.mutationLeaseId === right.mutationLeaseId
  )
}
