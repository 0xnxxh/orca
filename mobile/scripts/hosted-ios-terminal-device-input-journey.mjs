import path from 'node:path'
import {
  removeHostedIosDocumentFixture,
  seedHostedIosDocumentFixture,
  verifyHostedIosDocumentUpload
} from './hosted-ios-document-upload.mjs'
import { verifyHostedIosPhotoPermissionDenial } from './hosted-ios-photo-permission-denial.mjs'
import { verifyHostedIosTerminalClipboardImagePaste } from './hosted-ios-terminal-clipboard-image-paste.mjs'
import { verifyHostedIosTerminalClipboardPaste } from './hosted-ios-terminal-clipboard-paste.mjs'

export function verifyHostedIosTerminalInputJourney(args, clipboardImageOnly) {
  return clipboardImageOnly
    ? verifyHostedIosTerminalClipboardImageJourney(args)
    : verifyHostedIosTerminalDeviceInputJourney(args)
}

export async function verifyHostedIosTerminalClipboardImageJourney(args) {
  const terminalClipboardPaste = await verifyHostedIosTerminalClipboardPaste(args)
  const terminalClipboardImagePaste = await verifyHostedIosTerminalClipboardImagePaste({
    ...args,
    sessionDocument: terminalClipboardPaste.sessionDocument,
    terminalHandle: terminalClipboardPaste.evidence.terminalHandle
  })
  return { terminalClipboardImagePaste, terminalClipboardPaste }
}

export async function verifyHostedIosTerminalDeviceInputJourney(args, operations = {}) {
  const seedFixture = operations.seedFixture ?? seedHostedIosDocumentFixture
  const removeFixture = operations.removeFixture ?? removeHostedIosDocumentFixture
  const documentFixture = await seedFixture({
    deviceUdid: args.deviceUdid,
    fixturePath: path.join(args.worktree, 'mobile', 'assets', 'favicon.png')
  })
  try {
    const terminalClipboardPaste = await verifyHostedIosTerminalClipboardPaste(args)
    const documentUpload = await verifyHostedIosDocumentUpload({
      ...args,
      documentFixture,
      sessionDocument: terminalClipboardPaste.sessionDocument,
      terminalHandle: terminalClipboardPaste.evidence.terminalHandle
    })
    const photoPermissionDenial = await verifyHostedIosPhotoPermissionDenial({
      ...args,
      sessionDocument: documentUpload.sessionDocument,
      terminalHandle: terminalClipboardPaste.evidence.terminalHandle
    })
    const terminalClipboardImagePaste = await verifyHostedIosTerminalClipboardImagePaste({
      ...args,
      sessionDocument: photoPermissionDenial.sessionDocument,
      terminalHandle: terminalClipboardPaste.evidence.terminalHandle
    })
    return {
      documentUpload,
      photoPermissionDenial,
      terminalClipboardImagePaste,
      terminalClipboardPaste
    }
  } finally {
    await removeFixture(documentFixture.destinationPath)
  }
}
