const body = document.body
const tabs = [...document.querySelectorAll('[data-view]')]
const screens = [...document.querySelectorAll('[data-screen]')]

function showView(view) {
  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view))
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screen === view))
  window.location.hash = view
}

tabs.forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)))

document.querySelector('#theme-toggle')?.addEventListener('click', () => {
  body.classList.toggle('dark')
})

document.querySelectorAll('.agent-row').forEach((row) => {
  row.addEventListener('click', () => {
    document.querySelectorAll('.agent-row').forEach((candidate) => candidate.classList.remove('is-selected'))
    row.classList.add('is-selected')
  })
})

const mapAgentDetails = {
  'UI Builder': 'Refactoring dashboard information hierarchy',
  'API Integrator': 'Wiring metrics endpoints',
  'E2E Tester': 'Running dashboard interaction flows'
}

document.querySelectorAll('[data-map-agent]').forEach((node) => {
  node.addEventListener('click', () => {
    document.querySelectorAll('[data-map-agent]').forEach((candidate) => candidate.classList.remove('is-selected'))
    node.classList.add('is-selected')
    const name = node.dataset.mapAgent
    document.querySelector('#inspector-name').textContent = name
    document.querySelector('#inspector-action').textContent = mapAgentDetails[name]
  })
})

const initialView = window.location.hash.slice(1)
if (screens.some((screen) => screen.dataset.screen === initialView)) {
  showView(initialView)
}

window.addEventListener('hashchange', () => {
  const view = window.location.hash.slice(1)
  if (screens.some((screen) => screen.dataset.screen === view)) {
    showView(view)
  }
})
