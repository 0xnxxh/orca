import { describe, expect, it } from 'vitest'
import { findHostedAndroidBridgeLogFailures } from '../../scripts/hosted-android-emulator-session.mjs'

describe('hosted Android emulator session', () => {
  it('finds native bridge rejection, conversion, cast, and process failures', () => {
    const failures = findHostedAndroidBridgeLogFailures(`
      E/ReactNativeJS: Call to function 'ExpoMobileWebShell.postViewMessage' has been rejected.
      E/ReactNativeJS: java.lang.IllegalArgumentException: mobile_web_shell_view_unavailable
      E/ExpoModules: Cannot convert '{}' to a Kotlin type
      E/AndroidRuntime: java.lang.ClassCastException: View cannot be cast to MobileWebShellView
      E/AndroidRuntime: FATAL EXCEPTION: main
    `)

    expect(failures).toHaveLength(5)
  })

  it('ignores normal Android runtime and WebView output', () => {
    expect(
      findHostedAndroidBridgeLogFailures(`
        D/AndroidRuntime: Calling main entry com.android.commands.uiautomator.Launcher
        I/chromium: source: https://orca-mobile-web.invalid/
      `)
    ).toEqual([])
  })
})
