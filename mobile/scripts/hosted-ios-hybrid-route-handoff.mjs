import {
  tapHostedIosAccessibilityControl,
  waitForHostedIosAccessibilityLabelToDisappear,
  waitForHostedIosAccessibilityControlMatch
} from './hosted-ios-emulator-accessibility.mjs'

const NATIVE_ROUTE_CONTROLS = [
  'Open settings',
  'Open sessions in the terminal',
  'Skip notifications for now',
  'Back',
  'Back to worktrees',
  'Back to hosts'
]

export async function openHostedIosHybridRoute(
  emulator,
  timeoutMs,
  waitForControl = waitForHostedIosAccessibilityControlMatch,
  tapControl = tapHostedIosAccessibilityControl,
  waitForLabelToDisappear = waitForHostedIosAccessibilityLabelToDisappear
) {
  const deadline = Date.now() + timeoutMs
  for (let transition = 0; transition < NATIVE_ROUTE_CONTROLS.length; transition += 1) {
    const remainingMs = Math.max(1_000, deadline - Date.now())
    const control = await waitForControl(emulator, NATIVE_ROUTE_CONTROLS, remainingMs)
    await tapControl(emulator, control.label, remainingMs)
    await waitForLabelToDisappear(emulator, control.label, remainingMs)
    if (control.label === 'Open settings') {
      await tapControl(emulator, 'Open hybrid workspace UI', remainingMs)
      await waitForLabelToDisappear(emulator, 'Open hybrid workspace UI', remainingMs)
      return
    }
  }
  throw new Error('Could not reach native Settings before the hybrid route handoff')
}
