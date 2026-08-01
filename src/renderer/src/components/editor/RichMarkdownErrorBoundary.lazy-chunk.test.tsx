// @vitest-environment happy-dom

import { Suspense, act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { RichMarkdownErrorBoundary } from './RichMarkdownErrorBoundary'

const reportCrashMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/react-error-boundary-reporting', () => ({
  reportReactErrorBoundaryCrash: reportCrashMock
}))

const RELOAD_GUARD_KEY = 'orca:lazy-chunk-reload-attempted'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function createContainer(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return { container, root: createRoot(container) }
}

// Mirrors EditorContent: the Suspense sits above the boundary, which wraps the lazy editor.
function BoundaryHarness({ children }: { children: ReactNode }): ReactElement {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RichMarkdownErrorBoundary fileId="file-1">{children}</RichMarkdownErrorBoundary>
    </Suspense>
  )
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('RichMarkdownErrorBoundary lazy chunk containment', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    reportCrashMock.mockReset()
    window.sessionStorage.clear()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
    window.sessionStorage.clear()
    consoleError.mockRestore()
  })

  // Repro for crash b860def2: an app update swapped chunk hashes, lazy-with-retry
  // burned its one guarded reload, then surfaced LazyChunkLoadError here.
  it('renders the fallback without reporting after guarded dynamic import exhaustion', async () => {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
    const LazyRejectingImport = lazyWithRetry(
      () => Promise.reject(new SyntaxError("Unexpected token ':'")),
      { retries: 0 }
    )
    ;({ container, root } = createContainer())

    await act(async () => {
      root?.render(
        <BoundaryHarness>
          <LazyRejectingImport />
        </BoundaryHarness>
      )
    })
    await flushReactWork()
    await flushReactWork()

    expect(container?.textContent).toContain('rich markdown editor')
    expect(reportCrashMock).not.toHaveBeenCalled()
  })

  it('still reports ordinary render errors', async () => {
    const error = new Error('ordinary render failure')
    function BrokenEditor(): ReactElement {
      throw error
    }
    ;({ container, root } = createContainer())

    await act(async () => {
      root?.render(
        <BoundaryHarness>
          <BrokenEditor />
        </BoundaryHarness>
      )
    })

    expect(container?.textContent).toContain('rich markdown editor')
    expect(reportCrashMock).toHaveBeenCalledTimes(1)
    expect(reportCrashMock).toHaveBeenCalledWith(
      expect.objectContaining({
        boundaryId: 'editor.rich-markdown',
        surface: 'rich-markdown-editor',
        error
      })
    )
  })
})
