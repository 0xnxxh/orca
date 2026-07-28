import React from 'react'
import ReactDOM from 'react-dom/client'
import '@renderer/assets/main.css'
import '@xterm/xterm/css/xterm.css'
import { MobileWebShell } from './mobile-web-shell'

document.documentElement.classList.add('dark')

const root = document.getElementById('root')

if (!root) {
  throw new Error('Mobile web root is missing')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <MobileWebShell />
  </React.StrictMode>
)
