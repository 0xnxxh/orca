import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import React, { useEffect, useRef, useState } from 'react'
import { isTerminalQueryReply } from '../../shared/terminal-query-reply'
import type { MobileWebBridgeClient } from './mobile-web-bridge-client'
import {
  MobileWebTerminalEventState,
  type MobileWebTerminalEffect
} from './mobile-web-terminal-event-state'
import { MobileWebTerminalRequestScheduler } from './mobile-web-terminal-request-scheduler'
import { createMobileWebTerminalFileLinkProvider } from './mobile-web-terminal-file-links'
import { MobileWebTerminalPathPreview } from './mobile-web-terminal-path-preview'
import { useMobileWebTerminalPathPreview } from './use-mobile-web-terminal-path-preview'

export function MobileWebTerminal({
  client,
  workspaceId,
  tabId,
  connected
}: {
  client: MobileWebBridgeClient
  workspaceId: string
  tabId: string
  connected: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  const terminalPathPreview = useMobileWebTerminalPathPreview({
    client,
    workspaceId,
    tabId,
    connected
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || !connected) {
      return
    }
    setError(false)
    const terminal = new Terminal(terminalOptions())
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    fit.fit()
    const fileLinks = terminal.registerLinkProvider(
      createMobileWebTerminalFileLinkProvider(terminal, terminalPathPreview.openPath)
    )
    let eventState: MobileWebTerminalEventState
    let scheduler: MobileWebTerminalRequestScheduler
    const visible = document.visibilityState === 'visible'
    const subscription = client.terminalSubscribe(
      {
        operation: 'subscribe',
        workspaceId,
        tabId,
        viewport: viewport(terminal),
        visible
      },
      (event) => {
        const effect = eventState.apply(event)
        applyEffect(effect, terminal, scheduler)
        if (effect.type === 'error' || effect.type === 'closed') {
          setError(true)
        }
      },
      () => setError(true)
    )
    eventState = new MobileWebTerminalEventState(subscription.streamId)
    scheduler = new MobileWebTerminalRequestScheduler(client, subscription.streamId, () =>
      setError(true)
    )
    const input = terminal.onData((data) => {
      const encoded = new TextEncoder().encode(data)
      const operation = isTerminalQueryReply(data) ? 'queryReply' : 'input'
      scheduler.sendInput(operation, base64(encoded))
    })
    const resize = new ResizeObserver(() => {
      fit.fit()
      scheduler.resize(viewport(terminal))
    })
    resize.observe(container)
    const visibility = () => {
      scheduler.setVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', visibility)
    if (visible) {
      terminal.focus()
    }
    void subscription.ready.then(
      () => scheduler.markBridgeReady(),
      () => setError(true)
    )

    return () => {
      document.removeEventListener('visibilitychange', visibility)
      resize.disconnect()
      input.dispose()
      fileLinks.dispose()
      scheduler.dispose()
      subscription.unsubscribe()
      terminal.dispose()
    }
  }, [client, connected, tabId, terminalPathPreview.openPath, workspaceId])

  return (
    <div className="border-t border-border bg-editor-surface p-2">
      <div
        ref={containerRef}
        aria-label="Terminal"
        className="h-80 overflow-hidden rounded-md border border-border bg-background p-1"
      />
      {error ? (
        <p role="alert" className="px-1 pt-2 text-xs text-destructive">
          Terminal stream needs to reconnect.
        </p>
      ) : null}
      <MobileWebTerminalPathPreview
        preview={terminalPathPreview.preview}
        onClose={terminalPathPreview.closePreview}
      />
    </div>
  )
}

function applyEffect(
  effect: MobileWebTerminalEffect,
  terminal: Terminal,
  scheduler: MobileWebTerminalRequestScheduler
): void {
  if (effect.type === 'ready') {
    scheduler.markHostReady(effect.inputFloor, effect.queryReplyAuthority)
  } else if (effect.type === 'authority') {
    scheduler.setAuthority(effect.inputFloor, effect.queryReplyAuthority)
  } else if (effect.type === 'write') {
    terminal.write(effect.data, () => scheduler.acknowledge(effect.throughSequence))
  } else if (effect.type === 'replace') {
    terminal.reset()
    terminal.write(effect.data, () => {
      scheduler.markResynced()
      scheduler.acknowledge(effect.throughSequence)
    })
  } else if (effect.type === 'resync') {
    scheduler.requestResync(effect.fromSequence, effect.reason)
  }
}

function viewport(terminal: Terminal): { cols: number; rows: number } {
  return {
    cols: Math.max(2, terminal.cols),
    rows: Math.max(1, terminal.rows)
  }
}

function terminalOptions(): ConstructorParameters<typeof Terminal>[0] {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string) => styles.getPropertyValue(name).trim()
  return {
    allowProposedApi: false,
    cursorBlink: true,
    fontFamily: token('--font-mono') || 'monospace',
    fontSize: 13,
    scrollback: 5_000,
    theme: {
      background: token('--editor-surface') || token('--background'),
      foreground: token('--foreground'),
      cursor: token('--foreground'),
      selectionBackground: token('--accent')
    }
  }
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
