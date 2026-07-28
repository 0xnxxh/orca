import {
  tapHostedIosAccessibilityControl,
  tapHostedIosAccessibilityControlAtLastOccurrence,
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
  waitForLabelToDisappear = waitForHostedIosAccessibilityLabelToDisappear,
  tapLastControl = tapHostedIosAccessibilityControlAtLastOccurrence
) {
  const deadline = Date.now() + timeoutMs
  for (let transition = 0; transition < NATIVE_ROUTE_CONTROLS.length; transition += 1) {
    const remainingMs = Math.max(1_000, deadline - Date.now())
    const control = await waitForControl(emulator, NATIVE_ROUTE_CONTROLS, remainingMs)
    await tapUntilControlLeaves(
      emulator,
      control.label,
      deadline,
      tapControl,
      waitForLabelToDisappear,
      tapLastControl
    )
    if (control.label === 'Open settings') {
      await tapUntilControlLeaves(
        emulator,
        'Open hybrid workspace UI',
        deadline,
        tapControl,
        waitForLabelToDisappear,
        tapLastControl
      )
      return
    }
  }
  throw new Error('Could not reach native Settings before the hybrid route handoff')
}

async function tapUntilControlLeaves(
  emulator,
  label,
  deadline,
  tapControl,
  waitForLabelToDisappear,
  tapLastControl
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remainingMs = Math.max(1_000, deadline - Date.now())
    await tapControl(emulator, label, remainingMs)
    try {
      await waitForLabelToDisappear(emulator, label, Math.min(remainingMs, 5_000))
      return
    } catch {}
  }
  const remainingMs = Math.max(1_000, deadline - Date.now())
  await tapLastControl(emulator, label, remainingMs)
  await waitForLabelToDisappear(emulator, label, Math.min(remainingMs, 5_000))
}
