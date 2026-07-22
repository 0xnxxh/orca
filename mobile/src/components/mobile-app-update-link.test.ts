import { describe, expect, it } from 'vitest'
import { getMobileAppUpdateUrl } from './mobile-app-update-link'

describe('getMobileAppUpdateUrl', () => {
  it('uses the native App Store listing on iOS', () => {
    expect(getMobileAppUpdateUrl('ios', '0.0.31')).toBe(
      'itms-apps://apps.apple.com/app/orca-ide/id6766130217'
    )
  })

  it('links Android to the exact advertised GitHub release', () => {
    expect(getMobileAppUpdateUrl('android', '0.0.31')).toBe(
      'https://github.com/stablyai/orca/releases/tag/mobile-android-v0.0.31'
    )
    expect(getMobileAppUpdateUrl('android')).toBe('https://github.com/stablyai/orca/releases')
  })

  it('fails open without a supported distribution', () => {
    expect(getMobileAppUpdateUrl('web', '0.0.31')).toBeNull()
  })
})
