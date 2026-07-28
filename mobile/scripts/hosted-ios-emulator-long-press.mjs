import {
  runHostedIosEmulatorCommand,
  waitForHostedIosAccessibilityControlByLabelPrefix
} from './hosted-ios-emulator-accessibility.mjs'

const LONG_PRESS_MOVE_FRAMES = 60

export async function longPressHostedIosAccessibilityControlByLabelPrefix(
  args,
  labelPrefix,
  timeoutMs,
  runCommand = runHostedIosEmulatorCommand
) {
  const point = await waitForHostedIosAccessibilityControlByLabelPrefix(
    args,
    labelPrefix,
    timeoutMs,
    runCommand
  )
  await longPressHostedIosPoint(args, point, runCommand)
  return point
}

export async function longPressHostedIosPoint(
  args,
  point,
  runCommand = runHostedIosEmulatorCommand
) {
  const holdFrames = Array.from({ length: LONG_PRESS_MOVE_FRAMES }, () => ({
    type: 'move',
    ...point
  }))
  const gesture = [{ type: 'begin', ...point }, ...holdFrames, { type: 'end', ...point }]
  await runCommand(args, ['gesture', JSON.stringify(gesture)])
}
