const TOTAL_AGENTS = 196
const REVIEWED_DAY_COUNT = 26
const REVIEWED_WEEK_COUNT = 104
const REVIEWED_ALL_COUNT = 181

const stateSelection = {
  attention: true,
  working: true,
  finished: true
}
const projectSelection = {
  local: true,
  remote: true
}

let finishedScope = 'review'
let hostFilter = 'all'
let currentAgentNode = null

const canvasTitle = document.querySelector('#canvas-title')
const visibleSummary = document.querySelector('#visible-summary')
const hiddenSummaryCopy = document.querySelector('#hidden-summary-copy')
const emptyState = document.querySelector('#empty-state')
const doneModeNote = document.querySelector('.done-mode-note')
const terminalOverlay = document.querySelector('#terminal-overlay')
const terminalWorkspace = document.querySelector('#terminal-workspace')
const terminalMeta = document.querySelector('#terminal-meta')
const terminalCommand = document.querySelector('#terminal-command')
const terminalReply = document.querySelector('#terminal-reply')
const resultDisposition = document.querySelector('#result-disposition')
const pinAgent = document.querySelector('#pin-agent')
const reviewAgent = document.querySelector('#review-agent')
const closeTerminal = document.querySelector('#close-terminal')
const doneInspector = document.querySelector('#done-inspector')
const doneWorkspaceName = document.querySelector('#done-workspace-name')
const doneCountLabel = document.querySelector('#done-count-label')
const doneAgentGrid = document.querySelector('#done-agent-grid')
const closeDoneInspector = document.querySelector('#close-done-inspector')
const searchInput = document.querySelector('#agent-search')
const isMac = navigator.userAgent.includes('Mac')

document.querySelectorAll('kbd[data-mac]').forEach((key) => {
  key.textContent = isMac ? key.dataset.mac : key.dataset.other
})

function allAgentNodes() {
  return [...document.querySelectorAll('.agent-node')]
}

function syncAgentState(node) {
  const state = node.dataset.agentStatus
  let marker = node.querySelector('.agent-state')
  if (!marker) {
    marker = document.createElement('span')
    node.querySelector('.agent-avatar')?.after(marker)
  }
  marker.className = `agent-state ${state}`
  marker.setAttribute('aria-label', state === 'finished' ? 'Done' : 'Working')
  marker.innerHTML =
    state === 'finished'
      ? '<svg class="icon" aria-hidden="true"><use href="#i-circle-check"></use></svg>'
      : ''
}

function projectAllowed(projectKey) {
  return projectSelection[projectKey] && (hostFilter === 'all' || hostFilter === projectKey)
}

function isPinned(node) {
  return node.dataset.pinned === 'true'
}

function finishedNodeMatchesScope(node) {
  if (finishedScope !== 'review') return true
  return node.dataset.reviewState === 'unreviewed'
}

function nodeMatchesSearch(node) {
  const query = searchInput?.value.trim().toLowerCase() ?? ''
  if (!query) return true
  return `${node.dataset.agent} ${node.dataset.workspace}`.toLowerCase().includes(query)
}

function shouldShowNode(node) {
  if (isPinned(node)) return nodeMatchesSearch(node)
  const projectKey = node.closest('[data-project-key]')?.dataset.projectKey
  if (!projectAllowed(projectKey) || !nodeMatchesSearch(node)) return false
  if (node.dataset.agentStatus === 'working') return stateSelection.working
  return stateSelection.finished && finishedNodeMatchesScope(node)
}

function reviewedClusterCount(cluster) {
  if (finishedScope === 'day') return Number(cluster.dataset.dayCount)
  if (finishedScope === 'week') return Number(cluster.dataset.weekCount)
  if (finishedScope === 'all') return Number(cluster.dataset.allCount)
  return 0
}

function updateCluster(cluster) {
  const projectKey = cluster.closest('[data-project-key]')?.dataset.projectKey
  const count = reviewedClusterCount(cluster)
  const queryActive = Boolean(searchInput?.value.trim())
  const visible = stateSelection.finished && projectAllowed(projectKey) && count > 0 && !queryActive
  cluster.classList.toggle('is-visible', visible)
  cluster.dataset.currentCount = String(count)
  const label = cluster.querySelector('strong')
  if (label) label.textContent = `${count} reviewed`
  return visible ? count : 0
}

function scopeFinishedCount(individualFinishedCount) {
  if (finishedScope === 'day') return individualFinishedCount + REVIEWED_DAY_COUNT
  if (finishedScope === 'week') return individualFinishedCount + REVIEWED_WEEK_COUNT
  if (finishedScope === 'all') return individualFinishedCount + REVIEWED_ALL_COUNT
  return allAgentNodes().filter(
    (node) => node.dataset.agentStatus === 'finished' && node.dataset.reviewState === 'unreviewed'
  ).length
}

function updateCounts(visibleCount) {
  const nodes = allAgentNodes()
  const workingCount = nodes.filter((node) => node.dataset.agentStatus === 'working').length
  const individualFinishedCount = nodes.filter(
    (node) => node.dataset.agentStatus === 'finished'
  ).length
  const unreviewedCount = nodes.filter(
    (node) => node.dataset.agentStatus === 'finished' && node.dataset.reviewState === 'unreviewed'
  ).length
  const totalFinished = individualFinishedCount + REVIEWED_ALL_COUNT
  document.querySelector('#working-count').textContent = String(workingCount)
  document.querySelector('#finished-count').textContent = String(totalFinished)
  document.querySelector('#review-count').textContent = String(unreviewedCount)
  document.querySelector('#day-count').textContent = String(
    individualFinishedCount + REVIEWED_DAY_COUNT
  )
  document.querySelector('#week-count').textContent = String(
    individualFinishedCount + REVIEWED_WEEK_COUNT
  )
  document.querySelector('#all-finished-count').textContent = String(totalFinished)
  canvasTitle.textContent = `Focus · ${visibleCount} of ${TOTAL_AGENTS} agents`
  visibleSummary.textContent = `${visibleCount} of ${TOTAL_AGENTS} shown`
  const hiddenCount = TOTAL_AGENTS - visibleCount
  const defaultFocus =
    stateSelection.attention &&
    stateSelection.working &&
    stateSelection.finished &&
    finishedScope === 'review' &&
    projectSelection.local &&
    projectSelection.remote &&
    hostFilter === 'all' &&
    !searchInput?.value.trim()
  hiddenSummaryCopy.textContent = defaultFocus
    ? `${hiddenCount} reviewed results hidden`
    : `${hiddenCount} agents hidden by filters`
  document.querySelector('#show-reviewed').textContent = hiddenSummaryCopy.textContent
  const finishedScopeCount = scopeFinishedCount(individualFinishedCount)
  doneModeNote?.classList.toggle(
    'is-visible',
    stateSelection.finished && finishedScopeCount > unreviewedCount
  )
}

function updateContainers() {
  document.querySelectorAll('.workspace-ring').forEach((workspace) => {
    const hasVisibleContent = Boolean(
      workspace.querySelector('.agent-node:not(.is-filtered-out), .done-cluster.is-visible')
    )
    workspace.classList.toggle('is-filtered-out', !hasVisibleContent)
  })
  document.querySelectorAll('[data-project-key]').forEach((project) => {
    const hasPinned = Boolean(project.querySelector('.agent-node.is-pinned'))
    const hasVisibleContent = Boolean(
      project.querySelector(
        '.agent-node:not(.is-filtered-out), .done-cluster.is-visible, .workspace-ring:not(.is-filtered-out)'
      )
    )
    project.classList.toggle('is-filtered-out', !hasVisibleContent && !hasPinned)
  })
}

function applyFilters() {
  let visibleCount = 0
  allAgentNodes().forEach((node) => {
    const visible = shouldShowNode(node)
    node.classList.toggle('is-filtered-out', !visible)
    if (visible) visibleCount += 1
  })
  document.querySelectorAll('.done-cluster').forEach((cluster) => {
    visibleCount += updateCluster(cluster)
  })
  updateContainers()
  emptyState?.classList.toggle('is-visible', visibleCount === 0)
  updateCounts(visibleCount)
  document.querySelectorAll('[data-finished-scope]').forEach((button) => {
    button.disabled = !stateSelection.finished
  })
}

function setFinishedScope(scope) {
  finishedScope = scope
  document.querySelectorAll('[data-finished-scope]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.finishedScope === scope)
  })
  closeCompletedAgents()
  applyFilters()
}

document.querySelectorAll('[data-state-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const state = button.dataset.stateToggle
    stateSelection[state] = !stateSelection[state]
    button.classList.toggle('is-active', stateSelection[state])
    button.setAttribute('aria-pressed', String(stateSelection[state]))
    applyFilters()
  })
})

document.querySelectorAll('[data-finished-scope]').forEach((button) => {
  button.addEventListener('click', () => setFinishedScope(button.dataset.finishedScope))
})

document.querySelectorAll('[data-project-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const project = button.dataset.projectToggle
    projectSelection[project] = !projectSelection[project]
    button.classList.toggle('is-active', projectSelection[project])
    button.setAttribute('aria-pressed', String(projectSelection[project]))
    applyFilters()
  })
})

document.querySelectorAll('[data-host-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    hostFilter = button.dataset.hostFilter
    document.querySelectorAll('[data-host-filter]').forEach((option) => {
      option.classList.toggle('is-active', option === button)
    })
    applyFilters()
  })
})

function resetFocus() {
  Object.assign(stateSelection, { attention: true, working: true, finished: true })
  Object.assign(projectSelection, { local: true, remote: true })
  hostFilter = 'all'
  searchInput.value = ''
  document.querySelectorAll('[data-state-toggle], [data-project-toggle]').forEach((button) => {
    button.classList.add('is-active')
    button.setAttribute('aria-pressed', 'true')
  })
  document.querySelectorAll('[data-host-filter]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.hostFilter === 'all')
  })
  setFinishedScope('review')
}

function showAllAgents() {
  resetFocus()
  setFinishedScope('all')
}

document.querySelector('#clear-filters')?.addEventListener('click', showAllAgents)
document.querySelector('#show-reviewed')?.addEventListener('click', showAllAgents)
document.querySelector('#hidden-summary')?.addEventListener('click', showAllAgents)
document.querySelector('#reset-empty-state')?.addEventListener('click', resetFocus)
searchInput?.addEventListener('input', applyFilters)

function updateTerminalActions(node, detachedResult = false) {
  const finished = node?.dataset.agentStatus === 'finished'
  pinAgent.hidden = !finished
  reviewAgent.hidden = !finished
  if (!finished) {
    resultDisposition.textContent = detachedResult
      ? 'Reviewed result · reopened from history'
      : 'Working · conversation remains visible'
    return
  }
  const pinned = isPinned(node)
  pinAgent.setAttribute('aria-pressed', String(pinned))
  pinAgent.lastChild.textContent = pinned ? ' Pinned' : ' Keep visible'
  const reviewed = node.dataset.reviewState === 'reviewed'
  resultDisposition.textContent = reviewed
    ? pinned
      ? 'Reviewed · pinned in Focus'
      : 'Reviewed result'
    : 'Seen · remains in Focus until reviewed'
  reviewAgent.hidden = reviewed
}

function openAgentTerminal({ agent, workspace, duration, done = false, node = null }) {
  if (!terminalOverlay) return
  currentAgentNode = node
  if (node?.dataset.agentStatus === 'finished') {
    node.dataset.seen = 'true'
  }
  terminalWorkspace.textContent = workspace
  terminalMeta.textContent = `${agent} · ${done ? `Finished ${duration}` : `Working ${duration}`}`
  terminalCommand.textContent = done
    ? `${agent} finished. The result is ready for review.`
    : `Live output from ${agent}…`
  terminalReply.value = ''
  terminalReply.placeholder = done
    ? 'Send another message to continue this agent…'
    : 'Send another message to this agent…'
  updateTerminalActions(node, done && !node)
  terminalOverlay.classList.add('is-open')
  terminalOverlay.setAttribute('aria-hidden', 'false')
  terminalReply.focus()
}

function dismissTerminal() {
  terminalOverlay?.classList.remove('is-open')
  terminalOverlay?.setAttribute('aria-hidden', 'true')
  currentAgentNode = null
  applyFilters()
}

document.querySelectorAll('.agent-node').forEach((node) => {
  syncAgentState(node)
  node.addEventListener('click', () => {
    openAgentTerminal({
      agent: node.dataset.agent,
      workspace: node.dataset.workspace,
      duration: node.dataset.duration,
      done: node.dataset.agentStatus === 'finished',
      node
    })
  })
})

closeTerminal?.addEventListener('click', dismissTerminal)
terminalOverlay?.addEventListener('click', (event) => {
  if (event.target === terminalOverlay) dismissTerminal()
})

pinAgent?.addEventListener('click', () => {
  if (!currentAgentNode) return
  currentAgentNode.dataset.pinned = String(!isPinned(currentAgentNode))
  currentAgentNode.classList.toggle('is-pinned', isPinned(currentAgentNode))
  updateTerminalActions(currentAgentNode)
  applyFilters()
})

reviewAgent?.addEventListener('click', () => {
  if (!currentAgentNode) return
  currentAgentNode.dataset.reviewState = 'reviewed'
  currentAgentNode.dataset.seen = 'true'
  if (isPinned(currentAgentNode)) {
    updateTerminalActions(currentAgentNode)
    applyFilters()
  } else {
    dismissTerminal()
  }
})

terminalReply?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !terminalReply.value.trim()) return
  event.preventDefault()
  terminalCommand.textContent = `Continuing with: ${terminalReply.value.trim()}`
  terminalMeta.textContent = terminalMeta.textContent.replace(/Finished .+$/, 'Working · just now')
  terminalReply.value = ''
  terminalReply.placeholder = 'Message sent — the agent is working…'
  if (currentAgentNode?.dataset.agentStatus === 'finished') {
    currentAgentNode.dataset.agentStatus = 'working'
    currentAgentNode.dataset.duration = 'just now'
    currentAgentNode.classList.remove('agent-finished')
    currentAgentNode.querySelector('small').textContent = 'now'
    syncAgentState(currentAgentNode)
  }
  updateTerminalActions(currentAgentNode)
  applyFilters()
})

function completedAgentButton(workspace, index) {
  const button = document.createElement('button')
  button.className = 'done-agent'
  button.innerHTML = `
    <span><svg class="icon"><use href="#i-circle-check"></use></svg></span>
    <small>Agent ${String(index + 1).padStart(2, '0')}</small>
  `
  button.addEventListener('click', () => {
    openAgentTerminal({
      agent: `Agent ${String(index + 1).padStart(2, '0')}`,
      workspace,
      duration: 'earlier',
      done: true
    })
  })
  return button
}

function openCompletedAgents(cluster) {
  if (!doneInspector || !doneAgentGrid) return
  const workspace =
    cluster.closest('.workspace-ring')?.querySelector('header strong')?.textContent ?? 'Workspace'
  const count = Number(cluster.dataset.currentCount)
  doneWorkspaceName.textContent = workspace
  doneCountLabel.textContent = `${count} reviewed agents`
  doneAgentGrid.replaceChildren()
  for (let index = 0; index < Math.min(count, 14); index += 1) {
    doneAgentGrid.append(completedAgentButton(workspace, index))
  }
  doneInspector.classList.add('is-open')
}

function closeCompletedAgents() {
  doneInspector?.classList.remove('is-open')
}

document.querySelectorAll('.done-cluster').forEach((cluster) => {
  cluster.addEventListener('click', () => openCompletedAgents(cluster))
})

closeDoneInspector?.addEventListener('click', closeCompletedAgents)

document.querySelector('#review-visible')?.addEventListener('click', () => {
  allAgentNodes().forEach((node) => {
    if (
      !node.classList.contains('is-filtered-out') &&
      node.dataset.agentStatus === 'finished' &&
      node.dataset.reviewState === 'unreviewed'
    ) {
      node.dataset.reviewState = 'reviewed'
      node.dataset.seen = 'true'
    }
  })
  applyFilters()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (terminalOverlay?.classList.contains('is-open')) {
      dismissTerminal()
    } else {
      closeCompletedAgents()
    }
  }
  const usesPlatformModifier = isMac ? event.metaKey : event.ctrlKey
  if (usesPlatformModifier && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchInput?.focus()
  }
})

applyFilters()
