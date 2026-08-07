import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import {
  configureNotificationChannel,
  resetNotificationChannelConfigurationForTests
} from './local-notification-scheduling'

vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 'high' },
  setNotificationChannelAsync: vi.fn()
}))

vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 35 } }))

describe('Android notification channel configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetNotificationChannelConfigurationForTests()
  })

  it('configures the process-wide channel once across host subscriptions', async () => {
    configureNotificationChannel()
    configureNotificationChannel()
    await Promise.resolve()

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledOnce()
  })
})
