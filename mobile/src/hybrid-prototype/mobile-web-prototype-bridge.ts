import type {
  MobileWebPrototypeRequest,
  MobileWebPrototypeWorkspace
} from '../../../src/shared/mobile-web-prototype-contract'

const MAX_MESSAGE_BYTES = 16 * 1024
const MAX_REQUEST_ID_LENGTH = 128
const MAX_WORKSPACES = 200
const MAX_ID_LENGTH = 512
const MAX_NAME_LENGTH = 160
const MAX_REPO_LENGTH = 240
const MAX_BRANCH_LENGTH = 240
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(value)
  )
}

function boundedText(value: unknown, maximum: number, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maximum) : fallback
}

export function parseMobileWebPrototypeRequest(raw: string): MobileWebPrototypeRequest | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isRecord(value) || value.v !== 1) {
    return null
  }
  if (value.type === 'ready') {
    return { v: 1, type: 'ready' }
  }
  if (
    (value.type === 'workspace.list' || value.type === 'haptic.selection') &&
    isRequestId(value.id)
  ) {
    return { v: 1, type: value.type, id: value.id }
  }
  return null
}

export function sanitizeMobileWebPrototypeWorkspaces(
  result: unknown
): MobileWebPrototypeWorkspace[] {
  if (!isRecord(result) || !Array.isArray(result.worktrees)) {
    throw new Error('Host returned an invalid workspace list.')
  }
  const workspaces: MobileWebPrototypeWorkspace[] = []
  for (const value of result.worktrees.slice(0, MAX_WORKSPACES)) {
    if (!isRecord(value) || typeof value.worktreeId !== 'string' || !value.worktreeId) {
      continue
    }
    const terminalCount =
      typeof value.liveTerminalCount === 'number' &&
      Number.isInteger(value.liveTerminalCount) &&
      value.liveTerminalCount >= 0
        ? Math.min(value.liveTerminalCount, 10_000)
        : 0
    workspaces.push({
      id: value.worktreeId.slice(0, MAX_ID_LENGTH),
      name: boundedText(value.displayName, MAX_NAME_LENGTH, 'Workspace'),
      repo: boundedText(value.repo, MAX_REPO_LENGTH, 'Repository'),
      branch: boundedText(value.branch, MAX_BRANCH_LENGTH, 'No branch'),
      isActive: value.isActive === true,
      liveTerminalCount: terminalCount
    })
  }
  return workspaces
}
