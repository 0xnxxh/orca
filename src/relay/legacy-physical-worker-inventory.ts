export type LegacyPhysicalWorkerPty = Readonly<{
  id: string
  incarnationId: string
  processId: number | null
  cwd: string
  title: string
  worktreeId?: string
  terminalHandle?: string
}>

export function parseLegacyPhysicalWorkerPty(value: unknown): LegacyPhysicalWorkerPty {
  if (typeof value !== 'object' || value === null) {
    throw new Error('legacy physical worker PTY inventory entry is invalid')
  }
  const entry = value as Record<string, unknown>
  if (
    typeof entry.id !== 'string' ||
    !entry.id ||
    typeof entry.incarnationId !== 'string' ||
    !entry.incarnationId ||
    typeof entry.cwd !== 'string' ||
    typeof entry.title !== 'string'
  ) {
    throw new Error('legacy physical worker PTY inventory identity is invalid')
  }
  return Object.freeze({
    id: entry.id,
    incarnationId: entry.incarnationId,
    processId: positiveInteger(entry.processId) ? entry.processId : null,
    cwd: entry.cwd,
    title: entry.title,
    ...(typeof entry.worktreeId === 'string' ? { worktreeId: entry.worktreeId } : {}),
    ...(typeof entry.terminalHandle === 'string' ? { terminalHandle: entry.terminalHandle } : {})
  })
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}
