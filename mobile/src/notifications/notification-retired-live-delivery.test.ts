import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import type { RpcClient } from '../transport/rpc-client'
import { subscribeToDesktopNotifications } from './mobile-notifications'
import {
  resetHostNotificationSessionsForTests,
  retireHostNotificationState
} from './notification-reconnect-catchup'
import { loadPushNotificationsEnabled } from '../storage/preferences'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  removeItem: vi.fn(async () => undefined)
}))

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  dismissNotificationAsync: vi.fn()
}))

vi.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 18 } }))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorage
}))

vi.mock('../storage/preferences', () => ({ loadPushNotificationsEnabled: vi.fn() }))

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('retired host live delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHostNotificationSessionsForTests()
  })

  it('drops queued delivery after the host subscription is retired', async () => {
    vi.mocked(loadPushNotificationsEnabled).mockResolvedValue(true)
    vi.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      status: 'granted',
      canAskAgain: true
    } as never)
    let finishFirstSchedule: (identifier: string) => void = () => {}
    vi.mocked(Notifications.scheduleNotificationAsync).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishFirstSchedule = resolve
      })
    )
    let onEvent: ((data: unknown) => void) | null = null
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return vi.fn()
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn()
    } as unknown as RpcClient

    const unsubscribe = subscribeToDesktopNotifications(client, 'host-retired')
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'First',
      body: 'First body',
      notificationId: 'agent:first'
    })
    onEvent?.({
      type: 'notification',
      source: 'agent-task-complete',
      title: 'Second',
      body: 'Second body',
      notificationId: 'agent:second'
    })
    await flushAsync()
    unsubscribe()
    finishFirstSchedule('scheduled-first')
    await flushAsync()

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledOnce()
  })

  it('does not recreate a watermark when catch-up resolves after retirement', async () => {
    let onEvent: ((data: unknown) => void) | null = null
    let resolveCatchUp: (response: { ok: true; result: unknown }) => void = () => {}
    const catchUp = new Promise<{ ok: true; result: unknown }>((resolve) => {
      resolveCatchUp = resolve
    })
    const client = {
      subscribe: vi.fn((_method, _params, callback: (data: unknown) => void) => {
        onEvent = callback
        return () => {
          if (onEvent === callback) {
            onEvent = null
          }
        }
      }),
      getState: vi.fn(() => 'connected'),
      sendRequest: vi.fn((method: string) =>
        method === 'notifications.getMissedSince'
          ? catchUp
          : Promise.resolve({ ok: true, result: undefined })
      )
    } as unknown as RpcClient

    const firstUnsubscribe = subscribeToDesktopNotifications(client, 'host-retired-catch-up')
    onEvent?.({ type: 'ready', subscriptionId: 'first' })
    await flushAsync()
    firstUnsubscribe()

    const secondUnsubscribe = subscribeToDesktopNotifications(client, 'host-retired-catch-up')
    onEvent?.({ type: 'ready', subscriptionId: 'second' })
    await vi.waitFor(() =>
      expect(client.sendRequest).toHaveBeenCalledWith('notifications.getMissedSince', {
        lastSeenSeq: 0
      })
    )
    asyncStorage.setItem.mockClear()

    secondUnsubscribe()
    await retireHostNotificationState('host-retired-catch-up')
    resolveCatchUp({ ok: true, result: { notifications: [], epoch: 'retired-epoch' } })
    await flushAsync()

    expect(asyncStorage.setItem).not.toHaveBeenCalled()
  })
})
