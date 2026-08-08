export type TerminalAuthorityNamespace = Readonly<{
  authorityHostId: string
  namespaceId: string
}>

export type TerminalPaneGeneration = Readonly<{
  paneKey: string
  paneGenerationId: string
}>

export type TerminalSessionBinding = Readonly<{
  ownerIncarnationId: string
  physicalPtyId: string
  ptyIncarnationId: string
}>

export type TerminalAuthorityWriterIdentity = Readonly<{
  ownerToken: string
  epoch: number
}>

const MAX_AUTHORITY_ID_BYTES = 1_024
const MAX_AUTHORITY_STORAGE_PATH_BYTES = 32 * 1_024
const UNSAFE_AUTHORITY_TEXT = /[\p{Cc}\u2028\u2029]/u

export function assertAuthorityId(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    UNSAFE_AUTHORITY_TEXT.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_AUTHORITY_ID_BYTES
  ) {
    throw new Error(`${field} is invalid`)
  }
}

export function assertAuthorityStoragePath(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n') ||
    new TextEncoder().encode(value).byteLength > MAX_AUTHORITY_STORAGE_PATH_BYTES
  ) {
    throw new Error(`${field} is invalid`)
  }
}

export function assertAuthorityNamespace(
  value: unknown
): asserts value is TerminalAuthorityNamespace {
  if (!isRecord(value)) {
    throw new Error('authority namespace is invalid')
  }
  assertAuthorityId(value.authorityHostId, 'authorityHostId')
  assertAuthorityId(value.namespaceId, 'namespaceId')
}

export function assertPaneGeneration(value: unknown): asserts value is TerminalPaneGeneration {
  if (!isRecord(value)) {
    throw new Error('pane generation is invalid')
  }
  assertAuthorityId(value.paneKey, 'paneKey')
  assertAuthorityId(value.paneGenerationId, 'paneGenerationId')
}

export function assertTerminalBinding(value: unknown): asserts value is TerminalSessionBinding {
  if (!isRecord(value)) {
    throw new Error('terminal binding is invalid')
  }
  assertAuthorityId(value.ownerIncarnationId, 'ownerIncarnationId')
  assertAuthorityId(value.physicalPtyId, 'physicalPtyId')
  assertAuthorityId(value.ptyIncarnationId, 'ptyIncarnationId')
}

export function terminalPaneGenerationKey(value: TerminalPaneGeneration): string {
  return JSON.stringify([value.paneKey, value.paneGenerationId])
}

export function terminalPtyIncarnationKey(value: TerminalSessionBinding): string {
  return JSON.stringify([value.ownerIncarnationId, value.physicalPtyId, value.ptyIncarnationId])
}

export function sameTerminalBinding(
  left: TerminalSessionBinding | null,
  right: TerminalSessionBinding | null
): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.ownerIncarnationId === right.ownerIncarnationId &&
      left.physicalPtyId === right.physicalPtyId &&
      left.ptyIncarnationId === right.ptyIncarnationId
    )
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
