import React from 'react'
import { createRoot } from 'react-dom/client'
import './lab.css'
import LabApp from './LabApp'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <LabApp />
  </React.StrictMode>
)
