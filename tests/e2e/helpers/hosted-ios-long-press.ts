import {
  runHostedIosEmulatorCommand,
  type HostedIosEmulatorCommandOptions
} from './hosted-ios-mobile-launcher'

type NormalizedPoint = {
  x: number
  y: number
}

const LONG_PRESS_MOVE_FRAMES = 60

export async function sendHostedIosLongPress(
  args: HostedIosEmulatorCommandOptions,
  point: NormalizedPoint
): Promise<void> {
  const hold = Array.from({ length: LONG_PRESS_MOVE_FRAMES }, () => ({
    type: 'move',
    ...point
  }))
  const gesture = [{ type: 'begin', ...point }, ...hold, { type: 'end', ...point }]
  await runHostedIosEmulatorCommand(args, ['gesture', JSON.stringify(gesture)])
}
