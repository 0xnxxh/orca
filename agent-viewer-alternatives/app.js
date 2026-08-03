const activitySnapshot = window.AGENT_ACTIVITY_SNAPSHOT ?? {
  capturedAt: Date.now(),
  sourceSummary: { worktrees: 0, agents: 0, working: 0, done: 0, parentLinked: 0 },
  agents: []
}

function formatAge(ageMinutes) {
  if (ageMinutes < 1) return `${Math.max(1, Math.round(ageMinutes * 60))}s`
  if (ageMinutes < 60) return `${Math.floor(ageMinutes)}m`
  if (ageMinutes < 1440) return `${Math.floor(ageMinutes / 60)}h`
  return `${Math.floor(ageMinutes / 1440)}d`
}

function formatDuration(durationMs) {
  const minutes = Math.max(1, Math.round(durationMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

const agents = activitySnapshot.agents.map((agent) => {
  const ageMinutes = Math.max(0, (activitySnapshot.capturedAt - agent.updatedAt) / 60000)
  const age = formatAge(ageMinutes)
  const status = agent.status === 'waiting' ? 'attention' : agent.status
  const endedAt =
    status === 'done' ? (agent.completedAt ?? agent.updatedAt) : activitySnapshot.capturedAt
  const startedAt = Math.min(agent.startedAt ?? endedAt, endedAt)
  return {
    ...agent,
    status,
    startedAt,
    endedAt,
    duration: formatDuration(endedAt - startedAt),
    bucket: ['attention', 'blocked'].includes(status) ? 'attention' : status,
    ageMinutes,
    age,
    older: status === 'done' && ageMinutes > 120,
    response:
      status === 'done'
        ? `Finished ${age} ago. Open the session to review its result or send a follow-up.`
        : `${agent.detail}. Last activity ${age} ago.`,
    terminal:
      'Metadata-only prototype.\n\nThe app would reuse the live Dashboard terminal preview in this panel.',
    files: []
  }
})

const conceptMeta = {
  lineage: {
    kicker: 'Recommended companion view',
    title: 'Lineage atlas',
    description:
      'Worktree branches frame parent-and-child agent chains without changing icon size.',
    tradeoff: 'Best for tracing handoffs; slower when the only question is who replied last.'
  },
  lanes: {
    kicker: 'Current-data prototype',
    title: 'Activity lanes',
    description:
      'Each agent runs from its session start to completion or Now; children stay with their parent.',
    tradeoff:
      'Active sessions always stay visible; completed sessions older than two hours collapse by default.'
  }
}

const statusLabels = {
  attention: 'Needs you',
  working: 'Working',
  done: 'Done',
  blocked: 'Blocked',
  idle: 'Idle'
}

const state = {
  concept: window.location.hash.slice(1) in conceptMeta ? window.location.hash.slice(1) : 'lanes',
  selectedAgentId: null,
  recipients: [],
  showOlder: false
}

const elements = {
  root: document.documentElement,
  tabs: [...document.querySelectorAll('[data-concept]')],
  panels: [...document.querySelectorAll('[data-panel]')],
  title: document.querySelector('#concept-title'),
  kicker: document.querySelector('#concept-kicker'),
  description: document.querySelector('#concept-description'),
  tradeoff: document.querySelector('#concept-tradeoff span'),
  stage: document.querySelector('#concept-stage'),
  viewer: document.querySelector('#viewer-layout'),
  agentPanel: document.querySelector('#agent-panel'),
  search: document.querySelector('#search'),
  recent: document.querySelector('#recent-filter'),
  status: document.querySelector('#status-filter'),
  project: document.querySelector('#project-filter'),
  worktree: document.querySelector('#worktree-filter'),
  result: document.querySelector('#filter-result'),
  older: document.querySelector('#older-toggle'),
  theme: document.querySelector('#theme-toggle'),
  talkDrop: document.querySelector('#talk-drop'),
  recipientList: document.querySelector('#recipient-list'),
  talkMessage: document.querySelector('#talk-message'),
  talkForm: document.querySelector('#talk-form'),
  talkSend: document.querySelector('.talk-send'),
  talkNote: document.querySelector('#talk-note'),
  toast: document.querySelector('#toast')
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`
}

function statusIcon(agent) {
  return `<span class="agent-icon"><span class="status-badge"></span>${icon('bot')}</span>`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function selectedClass(agent) {
  return agent.id === state.selectedAgentId ? ' is-selected' : ''
}

function filterAgents(includeOlder = state.showOlder) {
  const query = elements.search.value.trim().toLowerCase()
  const recentMinutes = Number(elements.recent.value)
  return agents.filter((agent) => {
    const matchesQuery =
      !query ||
      [agent.name, agent.project, agent.worktree, agent.response].some((value) =>
        value.toLowerCase().includes(query)
      )
    const matchesRecent = agent.status !== 'done' || agent.ageMinutes <= recentMinutes
    const matchesStatus =
      elements.status.value === 'all' ||
      agent.status === elements.status.value ||
      (elements.status.value === 'attention' && agent.bucket === 'attention')
    const matchesProject =
      elements.project.value === 'all' || agent.project === elements.project.value
    const matchesWorktree =
      elements.worktree.value === 'all' || agent.worktree === elements.worktree.value
    const matchesOlder = includeOlder || !agent.older
    return (
      matchesQuery &&
      matchesRecent &&
      matchesStatus &&
      matchesProject &&
      matchesWorktree &&
      matchesOlder
    )
  })
}

function newestAge(group) {
  return [...group].sort((a, b) => a.ageMinutes - b.ageMinutes)[0]?.age ?? '—'
}

function treeAgent(agent, isChild = false) {
  return `
    <div class="${isChild ? 'tree-child' : 'tree-root'}">
      <button
        class="tree-agent status-${agent.status}${selectedClass(agent)}"
        type="button"
        data-agent-id="${agent.id}"
        draggable="true"
        aria-label="Open ${escapeHtml(agent.name)} beside this lineage"
      >
        ${statusIcon(agent)}
        <span class="agent-copy">
          <strong>${escapeHtml(agent.name)}</strong>
          <span>${escapeHtml(agent.detail)}</span>
        </span>
        <time>${agent.age}</time>
      </button>
      <button
        class="add-recipient tree-add"
        type="button"
        data-add-recipient="${agent.id}"
        aria-label="Add ${escapeHtml(agent.name)} to Talk"
      >${icon('plus')}</button>
    </div>
  `
}

function renderAgentTree(worktreeAgents) {
  const ids = new Set(worktreeAgents.map((agent) => agent.id))
  const roots = worktreeAgents.filter((agent) => !agent.parent || !ids.has(agent.parent))
  return roots
    .map((root) => {
      const children = worktreeAgents.filter((agent) => agent.parent === root.id)
      return `
        <div class="agent-tree">
          ${treeAgent(root)}
          ${children.length ? `<div class="tree-children">${children.map((child) => treeAgent(child, true)).join('')}</div>` : ''}
        </div>
      `
    })
    .join('')
}

function renderLineage(visibleAgents) {
  const projects = [...new Set(visibleAgents.map((agent) => agent.project))]
  return `
    <div class="lineage-view">
      ${projects
        .map((project) => {
          const projectAgents = visibleAgents.filter((agent) => agent.project === project)
          const worktrees = [...new Set(projectAgents.map((agent) => agent.worktree))]
          return `
            <section class="project-lineage">
              <header>
                <h2>${escapeHtml(project)}</h2>
                <span>Project lineage</span>
                <time>${newestAge(projectAgents)} since latest response</time>
              </header>
              <div class="worktree-branches">
                ${worktrees
                  .map((worktree) => {
                    const worktreeAgents = projectAgents.filter(
                      (agent) => agent.worktree === worktree
                    )
                    const branchFrom = worktreeAgents.find((agent) => agent.branchFrom)?.branchFrom
                    return `
                      <article class="worktree-tree${branchFrom ? ' is-branch' : ''}">
                        <header class="worktree-heading">
                          ${icon('branch')}
                          <span>
                            <strong>${escapeHtml(worktree)}</strong>
                            <small>${branchFrom ? `from ${escapeHtml(branchFrom)}` : 'main worktree'}</small>
                          </span>
                          <time>${newestAge(worktreeAgents)}</time>
                        </header>
                        ${renderAgentTree(worktreeAgents)}
                      </article>
                    `
                  })
                  .join('')}
              </div>
            </section>
          `
        })
        .join('')}
    </div>
  `
}

const timelineRowHeight = 52
const timelineLineY = 37

function timelineWindow() {
  const minutes = Number(elements.recent.value)
  return {
    minutes,
    start: activitySnapshot.capturedAt - minutes * 60000,
    end: activitySnapshot.capturedAt
  }
}

function timelinePercent(timestamp, window) {
  const clamped = Math.min(window.end, Math.max(window.start, timestamp))
  return ((clamped - window.start) / (window.end - window.start)) * 100
}

function timelineBounds(agent, window) {
  const start = timelinePercent(agent.startedAt, window)
  const end = timelinePercent(agent.endedAt, window)
  const lineStart = end - start < 0.6 ? Math.max(0, end - 0.6) : start
  return {
    start,
    end,
    lineStart,
    width: Math.max(0.6, end - lineStart),
    response: timelinePercent(agent.updatedAt, window),
    clippedStart: agent.startedAt < window.start
  }
}

function formatTimelineTick(timestamp, window, isNow) {
  if (isNow) return 'Now'
  const options =
    window.minutes >= 1440
      ? { weekday: 'short', hour: 'numeric' }
      : { hour: 'numeric', minute: '2-digit' }
  return new Date(timestamp).toLocaleString([], options)
}

function orderLaneAgents(laneAgents) {
  const byId = new Map(laneAgents.map((agent) => [agent.id, agent]))
  const children = new Map()
  laneAgents.forEach((agent) => {
    if (!agent.parent || !byId.has(agent.parent)) return
    children.set(agent.parent, [...(children.get(agent.parent) ?? []), agent])
  })
  const byStart = (a, b) => a.startedAt - b.startedAt
  const ordered = []
  const visited = new Set()
  function visit(agent) {
    if (visited.has(agent.id)) return
    visited.add(agent.id)
    ordered.push(agent)
    ;(children.get(agent.id) ?? []).sort(byStart).forEach(visit)
  }
  laneAgents
    .filter((agent) => !agent.parent || !byId.has(agent.parent))
    .sort(byStart)
    .forEach(visit)
  laneAgents.sort(byStart).forEach(visit)
  return ordered
}

function timelineLaneKey(agent, agentsById) {
  const visited = new Set([agent.id])
  let root = agent
  while (root.parent && agentsById.has(root.parent) && !visited.has(root.parent)) {
    visited.add(root.parent)
    root = agentsById.get(root.parent)
  }
  return root.worktree
}

function renderLaneConnections(laneAgents, boundsById) {
  const indexById = new Map(laneAgents.map((agent, index) => [agent.id, index]))
  const paths = laneAgents
    .filter((agent) => indexById.has(agent.parent))
    .map((agent) => {
      const x = boundsById.get(agent.id).start
      const parentY = indexById.get(agent.parent) * timelineRowHeight + timelineLineY
      const childY = indexById.get(agent.id) * timelineRowHeight + timelineLineY
      return `<path d="M ${x} ${parentY} V ${childY}" />`
    })
    .join('')
  if (!paths) return ''
  return `
    <svg
      class="lane-lineage"
      viewBox="0 0 100 ${laneAgents.length * timelineRowHeight}"
      preserveAspectRatio="none"
      aria-hidden="true"
    >${paths}</svg>
  `
}

function renderTimelineAgent(agent, laneIds, laneWorktree, bounds) {
  const responseTick =
    bounds.response > bounds.start + 1 && bounds.response < bounds.end - 1
      ? `<span class="timeline-response-tick" title="Latest response" aria-hidden="true"></span>`
      : ''
  const isChild = agent.parent && laneIds.has(agent.parent)
  const labelSide = bounds.start > 72 ? ' is-label-left' : ''
  const clipped = bounds.clippedStart ? ' is-clipped-start' : ''
  const childLabel = isChild
    ? agent.worktree === laneWorktree
      ? ' · child agent'
      : ` · child · ${escapeHtml(agent.worktree)}`
    : ''
  return `
    <button
      class="timeline-agent status-${agent.status}${selectedClass(agent)}${isChild ? ' is-child' : ''}${clipped}"
      type="button"
      data-agent-id="${agent.id}"
      draggable="true"
      aria-label="Open ${escapeHtml(agent.name)}, ${agent.duration} session"
      style="--timeline-start:${bounds.start.toFixed(3)}%;--timeline-end:${bounds.end.toFixed(3)}%;--timeline-line-start:${bounds.lineStart.toFixed(3)}%;--timeline-width:${bounds.width.toFixed(3)}%;--timeline-response:${bounds.response.toFixed(3)}%"
    >
      <span class="timeline-agent-label${labelSide}">
        <strong>${escapeHtml(agent.name)}</strong>
        <small>${agent.duration} · ${agent.age} since response${childLabel}</small>
      </span>
      <span class="timeline-segment" aria-hidden="true"></span>
      ${responseTick}
      <span class="timeline-endpoint" aria-hidden="true"></span>
      ${statusIcon(agent)}
    </button>
  `
}

function renderLanes(visibleAgents) {
  const window = timelineWindow()
  const ticks = Array.from(
    { length: 5 },
    (_, index) => window.start + ((window.end - window.start) * index) / 4
  )
  const agentsById = new Map(visibleAgents.map((agent) => [agent.id, agent]))
  const laneKeyById = new Map(
    visibleAgents.map((agent) => [agent.id, timelineLaneKey(agent, agentsById)])
  )
  const worktrees = [...new Set(laneKeyById.values())].sort((a, b) => {
    const laneAge = (worktree) =>
      Math.min(
        ...visibleAgents
          .filter((agent) => laneKeyById.get(agent.id) === worktree)
          .map((agent) => agent.ageMinutes)
      )
    return laneAge(a) - laneAge(b)
  })
  return `
    <div class="lanes-view">
      <header class="lane-axis">
        <span class="axis-label">Worktree · session duration</span>
        <div class="axis-track">${ticks.map((tick, index) => `<span>${formatTimelineTick(tick, window, index === ticks.length - 1)}</span>`).join('')}</div>
      </header>
      ${worktrees
        .map((worktree) => {
          const laneAgents = orderLaneAgents(
            visibleAgents.filter((agent) => laneKeyById.get(agent.id) === worktree)
          )
          const laneIds = new Set(laneAgents.map((agent) => agent.id))
          const boundsById = new Map(
            laneAgents.map((agent) => [agent.id, timelineBounds(agent, window)])
          )
          return `
            <section class="activity-lane">
              <header class="lane-heading">
                <strong>${escapeHtml(worktree)}</strong>
                <span>${escapeHtml(laneAgents[0].project)}</span>
                <time>${newestAge(laneAgents)} since latest response</time>
              </header>
              <div class="lane-track">
                <div class="lane-timeline">
                  ${renderLaneConnections(laneAgents, boundsById)}
                  ${laneAgents.map((agent) => renderTimelineAgent(agent, laneIds, worktree, boundsById.get(agent.id))).join('')}
                </div>
              </div>
            </section>
          `
        })
        .join('')}
    </div>
  `
}

function renderEmpty() {
  return `<div class="empty-state">${icon('search')}<strong>No matching agents</strong><span>Broaden a filter or show older completed sessions.</span></div>`
}

function bindAgentInteractions() {
  document.querySelectorAll('[data-agent-id]').forEach((trigger) => {
    trigger.addEventListener('click', () => openAgent(trigger.dataset.agentId))
    trigger.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', trigger.dataset.agentId)
      event.dataTransfer.effectAllowed = 'copy'
    })
  })
  document.querySelectorAll('[data-add-recipient]').forEach((button) => {
    button.addEventListener('click', () => addRecipient(button.dataset.addRecipient))
  })
}

function render() {
  const visibleAgents = filterAgents()
  const hiddenOlder = filterAgents(true).filter((agent) => agent.older).length
  const activePanel = document.querySelector(`[data-panel="${state.concept}"]`)
  const renderers = { lineage: renderLineage, lanes: renderLanes }
  activePanel.innerHTML = visibleAgents.length
    ? renderers[state.concept](visibleAgents)
    : renderEmpty()
  const summary = activitySnapshot.sourceSummary
  const capturedAt = new Date(activitySnapshot.capturedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })
  elements.result.textContent = `${visibleAgents.length} shown · ${
    state.showOlder ? 'older results visible' : `${hiddenOlder} older results hidden`
  } · ${summary.agents} agents / ${summary.worktrees} worktrees · captured ${capturedAt}`
  bindAgentInteractions()
}

function switchConcept(concept) {
  state.concept = concept
  const meta = conceptMeta[concept]
  elements.tabs.forEach((tab) => {
    const active = tab.dataset.concept === concept
    tab.classList.toggle('is-active', active)
    tab.setAttribute('aria-selected', String(active))
  })
  elements.panels.forEach((panel) => {
    const active = panel.dataset.panel === concept
    panel.classList.toggle('is-active', active)
    panel.hidden = !active
  })
  elements.kicker.textContent = meta.kicker
  elements.title.textContent = meta.title
  elements.description.textContent = meta.description
  elements.tradeoff.textContent = meta.tradeoff
  if (window.location.hash.slice(1) !== concept) window.location.hash = concept
  render()
}

function findAgent(id) {
  return agents.find((agent) => agent.id === id)
}

function openAgent(id) {
  const agent = findAgent(id)
  if (!agent) return
  state.selectedAgentId = id
  elements.viewer.classList.add('has-panel')
  elements.agentPanel.hidden = false
  document.querySelector('#agent-panel-title').textContent = agent.name
  document.querySelector('#agent-panel-meta').textContent = `${agent.project} · ${agent.worktree}`
  const panelStatus = document.querySelector('#panel-status')
  panelStatus.className = agent.status
  panelStatus.textContent = statusLabels[agent.status]
  document.querySelector('#panel-age').textContent = `${agent.age} since response`
  document.querySelector('#panel-response').textContent = agent.response
  document.querySelector('#panel-terminal').textContent = agent.terminal
  const panelFiles = document.querySelector('.panel-files')
  panelFiles.hidden = agent.files.length === 0
  document.querySelector('#panel-files').innerHTML = agent.files
    .map((file) => `<li>${escapeHtml(file)}</li>`)
    .join('')
  document.querySelector('#panel-add-talk').dataset.agentId = id
  render()
  requestAnimationFrame(() => {
    document.querySelector(`[data-agent-id="${id}"]`)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    })
  })
}

function closeAgent() {
  state.selectedAgentId = null
  elements.viewer.classList.remove('has-panel')
  elements.agentPanel.hidden = true
  render()
}

function addRecipient(id) {
  const agent = findAgent(id)
  if (!agent || state.recipients.includes(id)) return
  state.recipients.push(id)
  renderRecipients()
  elements.talkNote.textContent = `${agent.name} added. Nothing has been sent.`
}

function removeRecipient(id) {
  state.recipients = state.recipients.filter((recipient) => recipient !== id)
  renderRecipients()
}

function renderRecipients() {
  elements.recipientList.innerHTML = state.recipients
    .map((id) => {
      const agent = findAgent(id)
      return `
        <span class="recipient-chip">
          ${escapeHtml(agent.name)}
          <button type="button" data-remove-recipient="${id}" aria-label="Remove ${escapeHtml(agent.name)}">
            ${icon('close')}
          </button>
        </span>
      `
    })
    .join('')
  elements.recipientList.querySelectorAll('[data-remove-recipient]').forEach((button) => {
    button.addEventListener('click', () => removeRecipient(button.dataset.removeRecipient))
  })
  elements.talkSend.disabled = state.recipients.length === 0 || !elements.talkMessage.value.trim()
}

let toastTimer
function showToast(message) {
  clearTimeout(toastTimer)
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2600)
}

function populateFilters() {
  const projects = [...new Set(agents.map((agent) => agent.project))].sort()
  const worktrees = [...new Set(agents.map((agent) => agent.worktree))].sort()
  elements.project.insertAdjacentHTML(
    'beforeend',
    projects
      .map((project) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`)
      .join('')
  )
  elements.worktree.insertAdjacentHTML(
    'beforeend',
    worktrees
      .map((worktree) => `<option value="${escapeHtml(worktree)}">${escapeHtml(worktree)}</option>`)
      .join('')
  )
}

elements.tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => switchConcept(tab.dataset.concept))
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = elements.tabs[(index + direction + elements.tabs.length) % elements.tabs.length]
    next.focus()
    switchConcept(next.dataset.concept)
  })
})

window.addEventListener('hashchange', () => {
  const concept = window.location.hash.slice(1)
  if (concept in conceptMeta && concept !== state.concept) switchConcept(concept)
})

;[elements.search, elements.recent, elements.status, elements.project, elements.worktree].forEach(
  (control) => control.addEventListener('input', render)
)
;[elements.recent, elements.status, elements.project, elements.worktree].forEach((control) =>
  control.addEventListener('change', render)
)

elements.older.addEventListener('click', () => {
  state.showOlder = !state.showOlder
  elements.older.setAttribute('aria-pressed', String(state.showOlder))
  elements.older.querySelector('span').textContent = state.showOlder ? 'Hide older' : 'Show older'
  render()
})

elements.theme.addEventListener('click', () => {
  const dark = elements.root.classList.toggle('dark')
  elements.theme.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme')
  localStorage.setItem('orca-agent-viewer-theme', dark ? 'dark' : 'light')
})

document.querySelector('#close-panel').addEventListener('click', closeAgent)
document.querySelector('#panel-add-talk').addEventListener('click', (event) => {
  addRecipient(event.currentTarget.dataset.agentId)
})
document.querySelector('#panel-open-worktree').addEventListener('click', () => {
  const agent = findAgent(state.selectedAgentId)
  showToast(`${agent.worktree} would open in Orca.`)
})

elements.talkDrop.addEventListener('dragover', (event) => {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  elements.talkDrop.classList.add('is-drag-over')
})
elements.talkDrop.addEventListener('dragleave', () => {
  elements.talkDrop.classList.remove('is-drag-over')
})
elements.talkDrop.addEventListener('drop', (event) => {
  event.preventDefault()
  elements.talkDrop.classList.remove('is-drag-over')
  addRecipient(event.dataTransfer.getData('text/plain'))
})

elements.talkMessage.addEventListener('input', renderRecipients)
elements.talkForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (elements.talkSend.disabled) return
  const recipientNames = state.recipients.map((id) => findAgent(id).name)
  showToast(`Follow-up sent to ${recipientNames.join(', ')}.`)
  elements.talkNote.textContent = `Sent to ${recipientNames.join(', ')}.`
  state.recipients = []
  elements.talkMessage.value = ''
  renderRecipients()
})

document.addEventListener('keydown', (event) => {
  const isMac = navigator.userAgent.includes('Mac')
  if (event.key.toLowerCase() === 'k' && (isMac ? event.metaKey : event.ctrlKey)) {
    event.preventDefault()
    elements.search.focus()
  }
  if (event.key === 'Escape' && !elements.agentPanel.hidden) closeAgent()
})

const savedTheme = localStorage.getItem('orca-agent-viewer-theme')
if (savedTheme) elements.root.classList.toggle('dark', savedTheme === 'dark')
elements.theme.setAttribute(
  'aria-label',
  elements.root.classList.contains('dark') ? 'Switch to light theme' : 'Switch to dark theme'
)
const isMac = navigator.userAgent.includes('Mac')
document.querySelector('#search-shortcut').textContent = isMac ? '⌘ K' : 'Ctrl+K'
populateFilters()
renderRecipients()
switchConcept(state.concept)
