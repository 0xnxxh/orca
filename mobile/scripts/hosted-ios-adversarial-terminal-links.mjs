import {
  stageHostedAdversarialTerminalLinksWithInput,
  verifyHostedAdversarialTerminalLinks
} from './hosted-adversarial-terminal-links.mjs'
import {
  tapHostedIosAccessibilityControl,
  tapHostedIosPoint
} from './hosted-ios-emulator-accessibility.mjs'
import {
  allowHostedIosPasteIfRequested,
  writeHostedIosSimulatorPasteboard
} from './hosted-ios-terminal-clipboard-paste.mjs'
import { activateHostedWebViewControl } from './hosted-webview-cdp-session.mjs'

const terminalTitle = 'Mobile Emulator'

export function verifyHostedIosAdversarialTerminalLinks(args) {
  return verifyHostedAdversarialTerminalLinks(
    {
      ...args,
      tapPoint: tapHostedIosPoint
    },
    {
      writeLinks: (linkArgs) => stageHostedIosAdversarialTerminalLinks(args, linkArgs)
    }
  )
}

async function stageHostedIosAdversarialTerminalLinks(args, linkArgs) {
  await activateHostedWebViewControl(args.document, {
    kind: 'text',
    value: terminalTitle
  })
  const terminalHandle = await stageHostedAdversarialTerminalLinksWithInput(
    linkArgs,
    async (command) => {
      await writeHostedIosSimulatorPasteboard(args.deviceUdid, command)
      await tapHostedIosAccessibilityControl(args.emulator, 'Paste', args.timeoutMs)
      await allowHostedIosPasteIfRequested(args.emulator, tapHostedIosAccessibilityControl)
      await tapHostedIosAccessibilityControl(args.emulator, 'Enter', args.timeoutMs)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await tapHostedIosAccessibilityControl(args.emulator, 'Enter', args.timeoutMs)
    }
  )
  await tapHostedIosAccessibilityControl(args.emulator, 'Done', 3_000).catch(() => {})
  return terminalHandle
}
