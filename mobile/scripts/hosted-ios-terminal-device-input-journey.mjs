import { verifyHostedIosPhotoPermissionDenial } from './hosted-ios-photo-permission-denial.mjs'
import { verifyHostedIosTerminalClipboardPaste } from './hosted-ios-terminal-clipboard-paste.mjs'

export async function verifyHostedIosTerminalDeviceInputJourney(args) {
  const terminalClipboardPaste = await verifyHostedIosTerminalClipboardPaste(args)
  const photoPermissionDenial = await verifyHostedIosPhotoPermissionDenial({
    ...args,
    sessionDocument: terminalClipboardPaste.sessionDocument,
    terminalHandle: terminalClipboardPaste.evidence.terminalHandle
  })
  return { photoPermissionDenial, terminalClipboardPaste }
}
