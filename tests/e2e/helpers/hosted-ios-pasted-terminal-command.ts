import { writeHostedIosSimulatorPasteboard } from '../../../mobile/scripts/hosted-ios-terminal-clipboard-paste.mjs'
import {
  HOSTED_IOS_TERMINAL_CLIPBOARD_PASTE_CAPTURE,
  hostedIosTerminalInputCaptureExpression
} from './hosted-ios-terminal-cdp-expressions'
import {
  runHostedIosEmulatorCommand,
  type HostedIosEmulatorCommandOptions
} from './hosted-ios-emulator-command'
import { waitForHostedIosAccessibilityControl } from './hosted-ios-accessibility'
import { waitForHostedIosEvaluation } from './hosted-ios-webview-cdp'

export async function sendHostedIosPastedTerminalCommand(
  args: HostedIosEmulatorCommandOptions & { discoveryUrl: string },
  command: string
): Promise<{ expected: string; requireCarriageReturn: true }> {
  await writeHostedIosSimulatorPasteboard(args.deviceUdid, command)
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await tapHostedIosAccessibilityControl(args, 'Paste', 20_000)
    await allowHostedIosPasteIfRequested(args)
    await waitForHostedIosEvaluation(
      args.discoveryUrl,
      5_000,
      hostedIosTerminalInputCaptureExpression,
      (value) => value.split(HOSTED_IOS_TERMINAL_CLIPBOARD_PASTE_CAPTURE).length - 1 >= attempt
    )
  }
  await waitForHostedIosEvaluation(
    args.discoveryUrl,
    10_000,
    `(() => {
      const label = Array.from(document.querySelectorAll('body *')).find(
        (candidate) =>
          candidate.children.length === 0 &&
          String(candidate.textContent ?? '').trim() === 'Enter'
      )
      const control = label?.closest('button,[role="button"],[tabindex]')
      if (!(control instanceof HTMLElement)) return 'missing'
      control.click()
      return 'clicked'
    })()`,
    (value) => value === 'clicked'
  )
  return {
    expected: HOSTED_IOS_TERMINAL_CLIPBOARD_PASTE_CAPTURE,
    requireCarriageReturn: true
  }
}

async function tapHostedIosAccessibilityControl(
  args: HostedIosEmulatorCommandOptions,
  label: string,
  timeoutMs: number
): Promise<void> {
  const control = await waitForHostedIosAccessibilityControl(args, label, timeoutMs)
  await runHostedIosEmulatorCommand(args, ['tap', String(control.x), String(control.y)])
}

async function allowHostedIosPasteIfRequested(
  args: HostedIosEmulatorCommandOptions
): Promise<void> {
  try {
    await tapHostedIosAccessibilityControl(args, 'Allow Paste', 3_000)
  } catch {
    // The prompt appears only after the first cross-app paste.
  }
}
