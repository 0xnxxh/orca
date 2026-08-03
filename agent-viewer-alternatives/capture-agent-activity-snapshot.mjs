import { execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const cli =
  process.env.ORCA_CLI_COMMAND ||
  (process.env.ORCA_DEV_REPO_ROOT ? 'orca-dev' : process.platform === 'linux' ? 'orca-ide' : 'orca')
const payload = JSON.parse(execFileSync(cli, ['worktree', 'ps', '--json'], { encoding: 'utf8' }))

if (!payload.ok || !Array.isArray(payload.result?.worktrees)) {
  throw new Error('Orca did not return a worktree snapshot')
}

const capturedAt = Date.now()
const worktrees = payload.result.worktrees
const allAgents = worktrees.flatMap((worktree) => worktree.agents ?? [])

function userDataPath(appName) {
  if (process.env.ORCA_AGENT_ACTIVITY_USER_DATA) {
    return process.env.ORCA_AGENT_ACTIVITY_USER_DATA
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName)
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), appName)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), appName)
}

function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function profileData(root) {
  const profileIndex = readJson(join(root, 'orca-profile-index.json'))
  const activeProfileId = profileIndex?.activeProfileId ?? 'local-default'
  return (
    readJson(join(root, 'profiles', activeProfileId, 'orca-data.json')) ??
    readJson(join(root, 'orca-data.json'))
  )
}

function collectTerminalStarts(data) {
  const sessions = [data?.workspaceSession, ...Object.values(data?.workspaceSessionsByHostId ?? {})]
  const starts = new Map()
  for (const session of sessions) {
    for (const tabs of Object.values(session?.tabsByWorktree ?? {})) {
      for (const tab of tabs) {
        if (!Number.isFinite(tab.createdAt)) continue
        const previous = starts.get(tab.id)
        if (previous === undefined || tab.createdAt > previous) starts.set(tab.id, tab.createdAt)
      }
    }
  }
  return starts
}

function lastStatusPaths(root) {
  const hooksDirectory = join(root, 'agent-hooks')
  if (!existsSync(hooksDirectory)) return []
  const direct = join(hooksDirectory, 'last-status.json')
  const nested = readdirSync(hooksDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(hooksDirectory, entry.name, 'last-status.json'))
  return [direct, ...nested].filter(existsSync)
}

function collectLastStatuses(roots) {
  const statuses = new Map()
  for (const path of new Set(roots.flatMap(lastStatusPaths))) {
    const file = readJson(path)
    for (const [paneKey, entry] of Object.entries(file?.entries ?? {})) {
      const previous = statuses.get(paneKey)
      if (!previous || (entry.receivedAt ?? 0) > (previous.receivedAt ?? 0)) {
        statuses.set(paneKey, entry)
      }
    }
  }
  return statuses
}

function firstLine(path) {
  if (!path || !existsSync(path)) return null
  const descriptor = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const length = readSync(descriptor, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, length).toString('utf8').split('\n', 1)[0]
  } finally {
    closeSync(descriptor)
  }
}

function sessionStartedAt(status) {
  try {
    const line = firstLine(status?.providerSession?.transcriptPath)
    if (!line) return null
    const timestamp = Date.parse(JSON.parse(line).timestamp)
    return Number.isFinite(timestamp) ? timestamp : null
  } catch {
    return null
  }
}

const appName = cli.includes('dev') ? 'orca-dev' : 'orca'
const dataRoot = userDataPath(appName)
const terminalStarts = collectTerminalStarts(profileData(dataRoot))
const statusRoots = appName === 'orca-dev' ? [dataRoot, userDataPath('orca')] : [dataRoot]
const lastStatuses = collectLastStatuses(statusRoots)

function truncate(value, length = 72) {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`
}

function sessionName(agent) {
  if (agent.displayName?.trim()) return truncate(agent.displayName.trim())
  if (agent.taskTitle?.trim()) return truncate(agent.taskTitle.trim())
  const prompt = agent.prompt?.trim() ?? ''
  const taskMarker = prompt.indexOf('=== TASK ===')
  const task = taskMarker >= 0 ? prompt.slice(taskMarker + 12).trim() : prompt
  const firstLine = task
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
  if (firstLine && !firstLine.startsWith('You are working inside Orca')) return truncate(firstLine)
  return agent.agentType?.toUpperCase() ?? 'AGENT'
}

const capturedAgents = worktrees.flatMap((worktree) =>
  (worktree.agents ?? [])
    .filter(
      (agent) =>
        agent.state !== 'done' || capturedAt - (agent.updatedAt ?? 0) <= 24 * 60 * 60 * 1000
    )
    .map((agent) => {
      const tabId = agent.paneKey.split(':', 1)[0]
      const status = lastStatuses.get(agent.paneKey)
      const transcriptStart = sessionStartedAt(status)
      const terminalStart = terminalStarts.get(tabId)
      const startedAt = transcriptStart ?? terminalStart ?? agent.stateStartedAt ?? agent.updatedAt
      return {
        id: agent.paneKey,
        name: sessionName(agent),
        agentType: agent.agentType ?? 'agent',
        project: worktree.repo,
        worktree: worktree.displayName,
        branchFrom: worktree.parentWorktreeId?.split(/[\\/]/).at(-1) ?? null,
        parent: agent.parentPaneKey ?? null,
        status: agent.state,
        startedAt,
        startSource: transcriptStart
          ? 'agent-session'
          : terminalStart
            ? 'terminal-tab'
            : 'current-state',
        completedAt: agent.state === 'done' ? (agent.updatedAt ?? null) : null,
        updatedAt: agent.updatedAt ?? 0,
        unread: worktree.unread === true,
        detail:
          agent.state === 'working' && agent.toolName
            ? `Using ${agent.toolName}`
            : agent.state === 'working'
              ? 'Working now'
              : 'Finished'
      }
    })
)

const snapshot = {
  capturedAt,
  sourceSummary: {
    worktrees: worktrees.filter((worktree) => (worktree.agents?.length ?? 0) > 0).length,
    agents: allAgents.length,
    working: allAgents.filter((agent) => agent.state === 'working').length,
    done: allAgents.filter((agent) => agent.state === 'done').length,
    parentLinked: allAgents.filter((agent) => agent.parentPaneKey).length,
    exactSessionStarts: capturedAgents.filter((agent) => agent.startSource === 'agent-session')
      .length
  },
  agents: capturedAgents
}

const json = `${JSON.stringify(snapshot, null, 2)}\n`
writeFileSync(join(directory, 'actual-agent-activity.json'), json)
writeFileSync(
  join(directory, 'actual-agent-activity.js'),
  `window.AGENT_ACTIVITY_SNAPSHOT = ${json}`
)
