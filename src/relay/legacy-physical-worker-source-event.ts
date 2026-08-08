import type { PtySourceDeliveryIdentity, PtySourceSpan } from '../shared/pty-source-credit-contract'
import { ptySourceSpanIsSplittable } from '../shared/pty-source-credit-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'
import { parsePtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'

export function parseLegacyPhysicalWorkerActivation(
  value: unknown,
  id: string,
  incarnationId: string
): PtySourceDeliveryIdentity {
  const activation = parsePtySourceReceivingActivation(value)
  if (!activation || activation.ptyIncarnation !== incarnationId) {
    throw new Error('legacy physical worker source activation is invalid')
  }
  return identityFromActivation(id, activation)
}

export function parseLegacyPhysicalWorkerSourceSpan(value: unknown): PtySourceSpan {
  if (typeof value !== 'object' || value === null) {
    throw new Error('legacy physical worker source span is invalid')
  }
  const span = value as Partial<PtySourceSpan>
  if (
    typeof span.id !== 'string' ||
    !span.id ||
    !positiveInteger(span.providerGeneration) ||
    !positiveInteger(span.clientGeneration) ||
    !positiveInteger(span.ownerGeneration) ||
    typeof span.ptyIncarnation !== 'string' ||
    !span.ptyIncarnation ||
    typeof span.deliveryToken !== 'string' ||
    !span.deliveryToken ||
    typeof span.spanId !== 'string' ||
    !span.spanId ||
    !nonNegativeInteger(span.sourceStartSu) ||
    !positiveInteger(span.sourceEndSu) ||
    Number(span.sourceEndSu) <= Number(span.sourceStartSu) ||
    !nonNegativeInteger(span.displayStart) ||
    !nonNegativeInteger(span.displayEnd) ||
    Number(span.displayEnd) < Number(span.displayStart) ||
    typeof span.data !== 'string' ||
    span.data.length === 0 ||
    (span.splittable !== undefined && typeof span.splittable !== 'boolean') ||
    (span.indivisible !== undefined && typeof span.indivisible !== 'boolean') ||
    (span.splittable !== undefined &&
      span.indivisible !== undefined &&
      span.splittable === span.indivisible) ||
    typeof span.transform !== 'object' ||
    span.transform === null ||
    typeof span.transform.transformed !== 'boolean' ||
    !positiveInteger(span.transform.rawLengthSu) ||
    typeof span.transform.scalarSafe !== 'boolean'
  ) {
    throw new Error('legacy physical worker source span is invalid')
  }
  const parsed = Object.freeze({
    id: span.id,
    providerGeneration: Number(span.providerGeneration),
    clientGeneration: Number(span.clientGeneration),
    ownerGeneration: Number(span.ownerGeneration),
    ptyIncarnation: span.ptyIncarnation,
    deliveryToken: span.deliveryToken,
    spanId: span.spanId,
    sourceStartSu: Number(span.sourceStartSu),
    sourceEndSu: Number(span.sourceEndSu),
    displayStart: Number(span.displayStart),
    displayEnd: Number(span.displayEnd),
    data: span.data,
    ...(span.splittable !== undefined ? { splittable: span.splittable } : {}),
    ...(span.indivisible !== undefined ? { indivisible: span.indivisible } : {}),
    transform: Object.freeze({ ...span.transform })
  })
  if (
    !ptySourceSpanIsSplittable(parsed) &&
    parsed.sourceEndSu - parsed.sourceStartSu > 256 * 1024
  ) {
    throw new Error('legacy physical worker indivisible source span is too large')
  }
  return parsed
}

export function parseLegacyPhysicalWorkerExit(
  value: unknown
): Readonly<{ id: string; incarnationId: string; code: number }> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('legacy physical worker exit is invalid')
  }
  const exit = value as Record<string, unknown>
  const incarnationId =
    typeof exit.incarnationId === 'string'
      ? exit.incarnationId
      : typeof exit.ptyIncarnation === 'string'
        ? exit.ptyIncarnation
        : ''
  if (
    typeof exit.id !== 'string' ||
    !exit.id ||
    !incarnationId ||
    !Number.isSafeInteger(exit.code)
  ) {
    throw new Error('legacy physical worker exit is invalid')
  }
  return Object.freeze({ id: exit.id, incarnationId, code: Number(exit.code) })
}

function identityFromActivation(
  id: string,
  activation: PtySourceReceivingActivation
): PtySourceDeliveryIdentity {
  return Object.freeze({
    id,
    providerGeneration: 1,
    clientGeneration: activation.clientGeneration,
    ownerGeneration: activation.ownerGeneration,
    ptyIncarnation: activation.ptyIncarnation,
    deliveryToken: activation.deliveryToken
  })
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
