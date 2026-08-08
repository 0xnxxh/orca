import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL,
  TERMINAL_AUTHORITY_APP_PROJECTION_EVENT,
  TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE,
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  type TerminalAuthorityAppProjectionSnapshot
} from '../../shared/terminal-authority-app-projection'
import {
  APP_CONSUMER,
  boundary,
  semanticPublication
} from '../session-authority/__tests__/terminal-authority-app-projection-fixture'
import { TerminalAuthorityAppProjectionStore } from '../session-authority/terminal-authority-app-projection-store'

const { handlers, handle, removeHandler } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: object }, value: unknown) => unknown>(),
  handle: vi.fn(),
  removeHandler: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle, removeHandler } }))
vi.mock('../orca-profiles/profile-index-store', () => ({
  ensureActiveOrcaProfile: () => ({ profileDirectory: '/tmp/orca-authority-ipc-profile' })
}))

import { registerPtyAuthorityOutcomeIpc } from './pty-authority-outcome-ipc'

const directories: string[] = []

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true })))
})

describe('pty authority projection IPC', () => {
  it('serves committed snapshots, fences senders, and awaits durable bell clear', async () => {
    handle.mockImplementation(
      (channel: string, handler: (event: { sender: object }, value: unknown) => unknown) => {
        handlers.set(channel, handler)
      }
    )
    const directory = await mkdtemp(path.join(tmpdir(), 'orca-authority-ipc-'))
    directories.push(directory)
    const store = await TerminalAuthorityAppProjectionStore.open({
      directory,
      databasePath: ':memory:'
    })
    store.beginBoundary(boundary(0))
    store.apply(semanticPublication(1))
    const events = new EventEmitter()
    const sent: { channel: string; value: unknown }[] = []
    const webContents = {
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
      send: (channel: string, value: unknown) => sent.push({ channel, value }),
      isDestroyed: () => false
    }
    registerPtyAuthorityOutcomeIpc({ isDestroyed: () => false, webContents } as never, {
      processIncarnationId: APP_CONSUMER.consumerIncarnationId,
      projectionStore: store
    })
    const subscribe = handlers.get(TERMINAL_AUTHORITY_APP_PROJECTION_SUBSCRIBE)!
    const clearBell = handlers.get(TERMINAL_AUTHORITY_APP_PROJECTION_CLEAR_BELL)!

    const snapshot = (await subscribe(
      { sender: webContents },
      subscription('renderer-1')
    )) as TerminalAuthorityAppProjectionSnapshot
    const row = snapshot.rows[0]!
    expect(row).toMatchObject({ attention: { pendingBellCount: 1 } })
    await expect(subscribe({ sender: {} }, subscription('renderer-stale'))).rejects.toThrow(
      'sender_stale'
    )

    await expect(
      clearBell(
        { sender: webContents },
        {
          version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
          consumerId: row.consumerId,
          namespace: row.namespace,
          pane: row.pane,
          expectedEvent: row.facts.bell!.event
        }
      )
    ).resolves.toBe(true)
    expect(store.snapshot(APP_CONSUMER.consumerId)[0]?.attention.pendingBellCount).toBe(0)
    expect(sent.at(-1)).toMatchObject({
      channel: TERMINAL_AUTHORITY_APP_PROJECTION_EVENT,
      value: {
        rows: [
          expect.objectContaining({
            attention: expect.objectContaining({ pendingBellCount: 0 })
          })
        ]
      }
    })

    events.emit('did-start-navigation', {}, 'app://renderer', false, true)
    await expect(
      subscribe({ sender: webContents }, subscription('renderer-2', 'renderer-1'))
    ).resolves.toMatchObject({ subscriptionIncarnationId: 'renderer-2' })
    store.close()
  })
})

function subscription(
  subscriptionIncarnationId: string,
  expectedSubscriptionIncarnationId: string | null = null
) {
  return {
    version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
    subscriptionIncarnationId,
    expectedSubscriptionIncarnationId
  }
}
