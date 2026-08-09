export type DesktopNotificationSource = 'agent-task-complete' | 'terminal-bell' | 'test'

export type DesktopNotificationEvent = {
  source: DesktopNotificationSource
  worktreeId?: string
  notificationId?: string
}

export type LocalNotificationData = {
  source: DesktopNotificationSource
  hostId: string
  worktreeId?: string
  notificationId?: string
}

export type NotificationNavigationOptions = {
  knownHostIds?: ReadonlySet<string>
}

export type NotificationNavigationTarget =
  | { kind: 'host'; hostId: string }
  | { kind: 'session'; hostId: string; hostWorkspaceId: string }

export type NotificationNavigation = {
  target: NotificationNavigationTarget
  path: string
}

const NOTIFICATION_HOST_ID_MAX_LENGTH = 512
const NOTIFICATION_WORKSPACE_ID_MAX_LENGTH = 512

function readBoundedNonEmptyString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    ? value
    : null
}

export function buildLocalNotificationData(
  event: DesktopNotificationEvent,
  hostId: string
): LocalNotificationData {
  const data: LocalNotificationData = {
    source: event.source,
    hostId
  }
  if (event.worktreeId) {
    data.worktreeId = event.worktreeId
  }
  if (event.notificationId) {
    data.notificationId = event.notificationId
  }
  return data
}

export function getNotificationNavigationPath(
  data: unknown,
  options: NotificationNavigationOptions = {}
): string | null {
  const target = getNotificationNavigationTarget(data, options)
  if (!target) {
    return null
  }
  return getNotificationNavigationTargetPath(target)
}

export async function resolveNotificationNavigation(
  data: unknown,
  loadKnownHosts: () => Promise<readonly { id: string }[]>
): Promise<NotificationNavigation | null> {
  let hosts: readonly { id: string }[]
  try {
    hosts = await loadKnownHosts()
  } catch {
    return null
  }
  const options = { knownHostIds: new Set(hosts.map((host) => host.id)) }
  const target = getNotificationNavigationTarget(data, options)
  return target ? { target, path: getNotificationNavigationTargetPath(target) } : null
}

export class LatestNotificationNavigationResolver {
  private latestSequence = 0

  async resolve(
    data: unknown,
    loadKnownHosts: () => Promise<readonly { id: string }[]>
  ): Promise<NotificationNavigation | null> {
    const sequence = ++this.latestSequence
    const navigation = await resolveNotificationNavigation(data, loadKnownHosts)
    return sequence === this.latestSequence ? navigation : null
  }
}

function getNotificationNavigationTargetPath(target: NotificationNavigationTarget): string {
  const hostPath = `/h/${encodeURIComponent(target.hostId)}`
  return target.kind === 'session'
    ? `${hostPath}/session/${encodeURIComponent(target.hostWorkspaceId)}`
    : hostPath
}

export function getNotificationNavigationTarget(
  data: unknown,
  options: NotificationNavigationOptions = {}
): NotificationNavigationTarget | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>
  const hostId = readBoundedNonEmptyString(record.hostId, NOTIFICATION_HOST_ID_MAX_LENGTH)
  if (!hostId) {
    return null
  }
  if (options.knownHostIds && !options.knownHostIds.has(hostId)) {
    return null
  }

  const worktreeId = readBoundedNonEmptyString(
    record.worktreeId,
    NOTIFICATION_WORKSPACE_ID_MAX_LENGTH
  )
  if (
    record.worktreeId !== undefined &&
    record.worktreeId !== null &&
    typeof record.worktreeId !== 'string'
  ) {
    return null
  }
  if (typeof record.worktreeId === 'string' && record.worktreeId.length > 0 && !worktreeId) {
    return null
  }
  if (!worktreeId) {
    return { kind: 'host', hostId }
  }

  return { kind: 'session', hostId, hostWorkspaceId: worktreeId }
}
