import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { DashboardPopoutRoot } from './components/dashboard-popout/DashboardPopoutRoot'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  installRendererCrashDiagnostics,
  recordRendererCrashBreadcrumb
} from './lib/crash-diagnostics'
import { applyDocumentTheme } from './lib/document-theme'
import { I18nProvider } from './i18n/I18nProvider'
import { translate } from './i18n/i18n'

// Why: the pop-out window is a separate BrowserWindow with its own React root,
// so it must run the same renderer bootstrap as main.tsx (crash diagnostics,
// theme, i18n, error boundary) rather than inheriting anything from the main
// window. It shares the preload/window.api but not the DOM or JS context.
recordRendererCrashBreadcrumb('popout_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics()

applyDocumentTheme('system', { disableTransitions: false })

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('popout_root_missing')
  throw new Error('Pop-out root element not found.')
}

// The main process loads popout.html with ?view=<name> so a single entry can
// host different dashboard layouts (kanban, etc.).
const requestedView = new URLSearchParams(window.location.search).get('view')

function PopoutRoot(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="dashboard-popout.root"
      surface="dashboard-popout"
      title={translate('dashboardPopout.recoverableError.title', 'Orca dashboard hit an error.')}
      description={translate(
        'dashboardPopout.recoverableError.description',
        'The dashboard could not finish rendering. Retry to remount it, or reopen it.'
      )}
    >
      <DashboardPopoutRoot view={requestedView} />
    </RecoverableRenderErrorBoundary>
  )
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <PopoutRoot />
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('popout_bootstrap_rendered')
