const tabs = [...document.querySelectorAll('[data-view]')]
const screens = [...document.querySelectorAll('[data-screen]')]
const isMac = navigator.userAgent.includes('Mac')

if (!isMac) {
  const shortcutLabels = new Map([
    ['⌘ K', 'Ctrl+K'],
    ['⌘ ⇧ O', 'Ctrl+Shift+O'],
    ['⌘ J', 'Ctrl+J']
  ])
  document.querySelectorAll('kbd').forEach((key) => {
    key.textContent = shortcutLabels.get(key.textContent.trim()) ?? key.textContent
  })
}

function showView(view) {
  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view))
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === view))
  if (window.location.hash.slice(1) !== view) window.location.hash = view
}

tabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)))
window.addEventListener('hashchange', () => {
  const view = window.location.hash.slice(1)
  if (screens.some((screen) => screen.dataset.screen === view)) showView(view)
})

function populateDots(selector) {
  document.querySelectorAll(selector).forEach((cloud) => {
    const count = Number(cloud.dataset.dots ?? 0)
    const working = Number(cloud.dataset.working ?? 0)
    for (let index = 0; index < count; index += 1) {
      const dot = document.createElement('i')
      if (index < working) dot.className = 'is-working'
      if (index === working && cloud.closest('.urgent')) dot.className = 'is-urgent'
      cloud.append(dot)
    }
  })
}

populateDots('.node-cloud, .tiny-agents')

const radar = document.querySelector('#radar-blips')
if (radar) {
  const counts = [
    { total: 9, min: 16, max: 27, type: 'urgent' },
    { total: 34, min: 29, max: 47, type: 'active' },
    { total: 71, min: 49, max: 68, type: '' },
    { total: 54, min: 70, max: 89, type: 'done' }
  ]
  let seed = 17
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  counts.forEach((group) => {
    for (let index = 0; index < group.total; index += 1) {
      const angle = random() * Math.PI * 2
      const radius = group.min + random() * (group.max - group.min)
      const blip = document.createElement('i')
      blip.className = group.type
      blip.style.left = `${50 + Math.cos(angle) * radius * 0.5}%`
      blip.style.top = `${50 + Math.sin(angle) * radius * 0.5}%`
      radar.append(blip)
    }
  })
}

const worktrees = [
  ['pr-8783-internal-review', 13, 3, 5, 5, 14, 'now'],
  ['mobile-9717-dup-sessions', 12, 2, 3, 7, 13, '22s'],
  ['pr-9190-internal-review', 12, 0, 4, 8, 13, '41s'],
  ['mobile-6600-save-host', 6, 1, 2, 3, 9, '1m'],
  ['mobile-pr-10148', 6, 0, 2, 4, 2, '2m'],
  ['orca-trust-dialog', 5, 1, 2, 2, 7, '3m'],
  ['codex-resume-argv-drop', 5, 0, 1, 4, 6, '3m'],
  ['mobile-ime-6995', 5, 0, 1, 4, 5, '5m'],
  ['mobile-6927-close-tabs', 5, 0, 2, 3, 4, '7m'],
  ['native-chat-draft-reachable', 4, 0, 2, 2, 6, '8m'],
  ['review-11464', 3, 1, 3, 0, 5, 'now'],
  ['i18n-architecture', 3, 0, 1, 2, 5, '11m'],
  ['review-pr-9177-2', 3, 0, 2, 1, 3, '12m'],
  ['repro-6713-input-dead', 2, 1, 1, 1, 5, '14m'],
  ['sta2373-respawn-deadsock', 2, 0, 1, 1, 6, '17m'],
  ['pty-provider-types-split', 4, 0, 1, 3, 4, '19m']
]

const matrixRows = document.querySelector('#matrix-rows')
worktrees.forEach(([name, total, needs, working, done, terminals, signal]) => {
  if (!matrixRows) return
  const row = document.createElement('button')
  row.className = `matrix-row${needs ? ' has-attention' : ''}`
  const dots = Array.from({ length: total }, (_, index) => `<i class="${index < needs ? 'urgent' : index < needs + working ? 'active' : 'done'}"></i>`).join('')
  row.innerHTML = `<span><svg class="icon"><use href="#i-folder"></use></svg><strong>${name}</strong><small>${total} agents</small></span><span class="fabric">${dots}</span><span class="${needs ? 'attention-text' : ''}">${needs || '—'}</span><span>${working}</span><span>${done}</span><span>${terminals}</span><span>${signal}</span>`
  matrixRows.append(row)
})

const timeline = document.querySelector('#timeline-grid')
worktrees.slice(0, 12).forEach(([name, total, needs, working], rowIndex) => {
  if (!timeline) return
  const row = document.createElement('div')
  row.className = `timeline-row${name === 'codex-resume-argv-drop' ? ' is-selected' : ''}`
  const segments = Array.from({ length: Math.min(total, 7) }, (_, index) => {
    const left = 6 + ((rowIndex * 17 + index * 13) % 60)
    const width = 8 + ((rowIndex * 7 + index * 9) % 24)
    const type = index < needs ? 'urgent' : index < working ? 'active' : 'done'
    return `<i class="time-segment ${type}" style="left:${left}%;width:${Math.min(width, 94 - left)}%"></i>`
  }).join('')
  row.innerHTML = `<span class="lane-name"><strong>${name}</strong><small>${total} agents</small></span><span class="lane-track">${segments}</span><span class="lane-count">${working} active</span>`
  timeline.append(row)
})

const initialView = window.location.hash.slice(1)
if (screens.some((screen) => screen.dataset.screen === initialView)) showView(initialView)
