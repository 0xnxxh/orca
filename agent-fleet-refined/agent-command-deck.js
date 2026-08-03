const isMac = navigator.userAgent.includes('Mac')
const terminalBackdrop = document.querySelector('#terminal-backdrop')
const responseForm = document.querySelector('#response-form')
const sentToast = document.querySelector('#sent-toast')

document.querySelectorAll('[data-mac][data-other]').forEach((label) => {
  label.textContent = isMac ? label.dataset.mac : label.dataset.other
})

function setTerminalOpen(open) {
  if (!terminalBackdrop) return
  terminalBackdrop.classList.toggle('is-open', open)
  terminalBackdrop.setAttribute('aria-hidden', String(!open))
  if (open) terminalBackdrop.querySelector('[data-close-terminal]')?.focus()
}

document.querySelectorAll('[data-open-terminal]').forEach((button) => {
  button.addEventListener('click', () => setTerminalOpen(true))
})

document.querySelectorAll('[data-close-terminal]').forEach((button) => {
  button.addEventListener('click', () => setTerminalOpen(false))
})

terminalBackdrop?.addEventListener('click', (event) => {
  if (event.target === terminalBackdrop) setTerminalOpen(false)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && terminalBackdrop?.classList.contains('is-open')) {
    setTerminalOpen(false)
  }
  const usesPlatformModifier = isMac ? event.metaKey : event.ctrlKey
  if (event.key === 'Enter' && usesPlatformModifier && !terminalBackdrop?.classList.contains('is-open')) {
    responseForm?.requestSubmit()
  }
})

responseForm?.addEventListener('submit', (event) => {
  event.preventDefault()
  sentToast?.classList.add('is-visible')
  window.setTimeout(() => sentToast?.classList.remove('is-visible'), 2200)
})

document.querySelectorAll('.response-mode button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.response-mode button').forEach((item) => item.classList.remove('is-active'))
    button.classList.add('is-active')
  })
})

document.querySelectorAll('.queue-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.queue-item').forEach((item) => item.classList.remove('is-selected'))
    button.classList.add('is-selected')
  })
})
