import type { PtyAdministrativeMutationAccess } from '../../../shared/pty-mutation-identity'

export function writeImmediateCurrentPty(ptyId: string, data: string): void {
  const write =
    window.api.pty.administrativeWriteImmediateCurrent ??
    window.api.pty.administrativeWriteCurrent ??
    window.api.pty.write
  write(ptyId, data)
}

export function writeImmediateCurrentPtyAccepted(ptyId: string, data: string): Promise<boolean> {
  const write =
    window.api.pty.administrativeWriteImmediateCurrentAccepted ??
    window.api.pty.administrativeWriteCurrentAccepted ??
    window.api.pty.writeAccepted
  return write(ptyId, data)
}

export function writePtyWithAdministrativeMutationAccess(
  ptyId: string,
  data: string,
  access: PtyAdministrativeMutationAccess
): boolean {
  const exactWrite = window.api.pty.administrativeWrite
  if (exactWrite) {
    if (access.mode === 'unavailable') {
      return false
    }
    exactWrite(ptyId, data, access)
    return true
  }
  if (access.mode !== 'legacy') {
    return false
  }
  writeImmediateCurrentPty(ptyId, data)
  return true
}

export async function capturePtyAdministrativeMutationAccess(
  ptyIds: readonly string[]
): Promise<Map<string, PtyAdministrativeMutationAccess>> {
  const capture = window.api.pty.captureAdministrativeMutationAccess
  if (!capture) {
    return new Map(ptyIds.map((ptyId) => [ptyId, { mode: 'legacy' } as const]))
  }
  return new Map((await capture([...new Set(ptyIds)])).map(({ id, access }) => [id, access]))
}

export function killPtyWithAdministrativeMutationAccess(
  ptyId: string,
  access: PtyAdministrativeMutationAccess,
  opts?: { keepHistory?: boolean }
): Promise<void> {
  const exactKill = window.api.pty.administrativeKill
  if (exactKill) {
    return opts ? exactKill(ptyId, access, opts) : exactKill(ptyId, access)
  }
  if (access.mode !== 'legacy') {
    return Promise.reject(new Error('pty_administrative_mutation_access_unsupported'))
  }
  const legacyKill = window.api.pty.administrativeKillCurrent ?? window.api.pty.kill
  return opts ? legacyKill(ptyId, opts) : legacyKill(ptyId)
}

export async function killPtyAtCurrentIncarnation(
  ptyId: string,
  opts?: { keepHistory?: boolean }
): Promise<void> {
  const accessByPtyId = await capturePtyAdministrativeMutationAccess([ptyId])
  const access = accessByPtyId.get(ptyId) ?? { mode: 'unavailable' }
  await killPtyWithAdministrativeMutationAccess(ptyId, access, opts)
}
