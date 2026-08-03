const svgNamespace = 'http://www.w3.org/2000/svg'
const isMac = navigator.userAgent.includes('Mac')
const canvas = document.querySelector('#rings-canvas')
const preview = document.querySelector('#terminal-preview')
const terminal = document.querySelector('#rings-terminal')
const responseForm = document.querySelector('#rings-response')
const toast = document.querySelector('#rings-toast')

document.querySelectorAll('[data-mac][data-other]').forEach((label) => {
  label.textContent = isMac ? label.dataset.mac : label.dataset.other
})

function agentDuration(state, globalIndex, clusterIndex) {
  if (state === 'needs') return 28 + ((globalIndex * 7 + clusterIndex * 5) % 32)
  if (state === 'working') return 1 + ((globalIndex * 13 + clusterIndex * 3) % 47)
  if (state === 'recent') return 2 + ((globalIndex * 5 + clusterIndex) % 24)
  return 1 + ((globalIndex * 3 + clusterIndex * 7) % 18)
}

function agentState(index, needs, working, recent) {
  if (index < needs) return 'needs'
  if (index < needs + working) return 'working'
  if (index < needs + working + recent) return 'recent'
  return 'tracking'
}

function previewAgent(node, event) {
  if (!preview || !canvas) return
  const state = node.dataset.state
  const duration = node.dataset.duration
  preview.classList.remove('is-demo')
  preview.classList.add('is-visible')
  preview.querySelector('header strong').textContent = node.dataset.agentName
  preview.querySelector('header small').textContent = `${node.dataset.worktree} · ${state} ${duration}m`
  preview.querySelector('pre').textContent = state === 'needs'
    ? '› Review complete. Implementation is ready.\n\nWaiting for cleanup retention policy.'
    : `› Live output from ${node.dataset.worktree}\n\n${duration} minutes active · no stall detected.`
  const bounds = canvas.getBoundingClientRect()
  const left = Math.min(event.clientX - bounds.left + 14, bounds.width - 294)
  const top = Math.min(event.clientY - bounds.top + 14, bounds.height - 150)
  preview.style.left = `${Math.max(8, left)}px`
  preview.style.top = `${Math.max(8, top)}px`
  node.classList.add('is-hovered')
}

let globalIndex = 0
document.querySelectorAll('.worktree').forEach((worktree, clusterIndex) => {
  const count = Number(worktree.dataset.count)
  const needs = Number(worktree.dataset.needs)
  const working = Number(worktree.dataset.working)
  const recent = Number(worktree.dataset.recent)
  const centerX = Number(worktree.dataset.cx)
  const centerY = Number(worktree.dataset.cy)
  const clusterRadius = Number(worktree.dataset.radius)
  const layer = worktree.querySelector('.agent-layer')

  for (let index = 0; index < count; index += 1) {
    const state = agentState(index, needs, working, recent)
    const duration = agentDuration(state, globalIndex, clusterIndex)
    const nodeRadius = 2.3 + Math.min(5.8, Math.log2(duration + 1) * .92)
    const angle = index * 2.399963 + clusterIndex * .71
    const orbit = count === 1 ? 0 : 8 + Math.sqrt((index + .35) / count) * (clusterRadius - 17)
    const node = document.createElementNS(svgNamespace, 'circle')
    node.setAttribute('cx', String(centerX + Math.cos(angle) * orbit))
    node.setAttribute('cy', String(centerY + Math.sin(angle) * orbit))
    node.setAttribute('r', nodeRadius.toFixed(2))
    node.setAttribute('class', `agent-node ${state}`)
    node.setAttribute('tabindex', '0')
    node.setAttribute('aria-label', `${worktree.dataset.name} agent ${index + 1}, ${state}, ${duration} minutes`)
    node.dataset.state = state
    node.dataset.duration = String(duration)
    node.dataset.worktree = worktree.dataset.name
    node.dataset.agentName = index === 0 ? 'Review coordinator' : index === 1 ? 'Cross-platform reviewer' : `Agent ${String(globalIndex + 1).padStart(3, '0')}`
    node.addEventListener('pointerenter', (event) => previewAgent(node, event))
    node.addEventListener('pointermove', (event) => previewAgent(node, event))
    node.addEventListener('pointerleave', () => {
      node.classList.remove('is-hovered')
      preview?.classList.remove('is-visible')
    })
    node.addEventListener('click', () => setTerminalOpen(true))
    layer?.append(node)
    globalIndex += 1
  }
})

function setTerminalOpen(open) {
  if (!terminal) return
  terminal.classList.toggle('is-open', open)
  terminal.setAttribute('aria-hidden', String(!open))
  if (open) terminal.querySelector('[data-close-terminal]')?.focus()
}

document.querySelectorAll('[data-open-terminal]').forEach((button) => {
  button.addEventListener('click', () => setTerminalOpen(true))
})

document.querySelectorAll('[data-close-terminal]').forEach((button) => {
  button.addEventListener('click', () => setTerminalOpen(false))
})

terminal?.addEventListener('click', (event) => {
  if (event.target === terminal) setTerminalOpen(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && terminal?.classList.contains('is-open')) setTerminalOpen(false)
  const usesPlatformModifier = isMac ? event.metaKey : event.ctrlKey
  if (event.key === 'Enter' && usesPlatformModifier && !terminal?.classList.contains('is-open')) {
    responseForm?.requestSubmit()
  }
})

responseForm?.addEventListener('submit', (event) => {
  event.preventDefault()
  toast?.classList.add('is-visible')
  window.setTimeout(() => toast?.classList.remove('is-visible'), 2200)
})
