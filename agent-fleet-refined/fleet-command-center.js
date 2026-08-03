const isMac = navigator.userAgent.includes('Mac')
const fleetBlips = document.querySelector('#fleet-blips')
const terminal = document.querySelector('#fleet-terminal')
const responseForm = document.querySelector('#fleet-response-form')
const toast = document.querySelector('#fleet-toast')

document.querySelectorAll('[data-mac][data-other]').forEach((label) => {
  label.textContent = isMac ? label.dataset.mac : label.dataset.other
})

if (fleetBlips) {
  const groups = [
    { count: 9, min: 13, max: 24, className: 'needs' },
    { count: 34, min: 26, max: 43, className: 'active' },
    { count: 71, min: 45, max: 66, className: '' },
    { count: 54, min: 68, max: 88, className: 'done' }
  ]
  let seed = 29
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  groups.forEach((group) => {
    for (let index = 0; index < group.count; index += 1) {
      const angle = random() * Math.PI * 2
      const radius = group.min + random() * (group.max - group.min)
      const blip = document.createElement('i')
      blip.className = group.className
      blip.style.left = `${50 + Math.cos(angle) * radius * 0.5}%`
      blip.style.top = `${50 + Math.sin(angle) * radius * 0.5}%`
      fleetBlips.append(blip)
    }
  })
}

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

document.querySelectorAll('.cluster-label').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.cluster-label').forEach((item) => item.classList.remove('is-selected'))
    button.classList.add('is-selected')
  })
})
