import { randomUUID } from 'node:crypto'
import { webContents } from 'electron'

import type {
  BrowserWebAuthnAccountRequest,
  BrowserWebAuthnAccountResponse
} from '../../shared/browser-webauthn-account'
import { browserManager } from './browser-manager'

export const BROWSER_WEBAUTHN_ACCOUNT_PICKER_TIMEOUT_MS = 60_000

type PendingAccountRequest = {
  browserPageId: string
  guest: Electron.WebContents
  renderer: Electron.WebContents
  credentialIds: Set<string>
  timer: ReturnType<typeof setTimeout>
  onDestroyed: () => void
  settle: (credentialId: string | null) => void
}

const pendingAccountRequests = new Map<string, PendingAccountRequest>()

function closeRendererPrompt(requestId: string, request: PendingAccountRequest): void {
  try {
    if (!request.renderer.isDestroyed()) {
      request.renderer.send('browser:webauthn-account-request-closed', { requestId })
    }
  } catch {
    // Renderer may be destroyed between the check and send.
  }
}

function cleanUpRequest(requestId: string, request: PendingAccountRequest): void {
  clearTimeout(request.timer)
  request.guest.removeListener('destroyed', request.onDestroyed)
  request.renderer.removeListener('destroyed', request.onDestroyed)
  pendingAccountRequests.delete(requestId)
}

export function requestBrowserWebAuthnAccount(
  details: Electron.SelectWebauthnAccountDetails
): Promise<string | null> {
  const guest = details.frame ? webContents.fromFrame(details.frame) : undefined
  if (!guest || guest.isDestroyed()) {
    return Promise.resolve(null)
  }
  const context = browserManager.getRendererContextForGuest(guest.id)
  if (!context || context.renderer.isDestroyed()) {
    return Promise.resolve(null)
  }

  const requestId = randomUUID()
  const requestPayload: BrowserWebAuthnAccountRequest = {
    requestId,
    browserPageId: context.browserPageId,
    relyingPartyId: details.relyingPartyId,
    accounts: details.accounts.map(({ credentialId, displayName, name }) => ({
      credentialId,
      ...(displayName ? { displayName } : {}),
      ...(name ? { name } : {})
    }))
  }

  return new Promise((resolve) => {
    let settled = false
    const settle = (credentialId: string | null = null): void => {
      if (settled) {
        return
      }
      settled = true
      const request = pendingAccountRequests.get(requestId)
      if (request) {
        cleanUpRequest(requestId, request)
        closeRendererPrompt(requestId, request)
      }
      resolve(credentialId)
    }
    const request: PendingAccountRequest = {
      browserPageId: context.browserPageId,
      guest,
      renderer: context.renderer,
      credentialIds: new Set(details.accounts.map((account) => account.credentialId)),
      timer: setTimeout(settle, BROWSER_WEBAUTHN_ACCOUNT_PICKER_TIMEOUT_MS),
      onDestroyed: () => settle(null),
      settle
    }
    pendingAccountRequests.set(requestId, request)
    guest.once('destroyed', request.onDestroyed)
    context.renderer.once('destroyed', request.onDestroyed)
    try {
      context.renderer.send('browser:webauthn-account-requested', requestPayload)
    } catch {
      settle(null)
    }
  })
}

export function respondToBrowserWebAuthnAccountRequest(
  sender: Electron.WebContents,
  response: BrowserWebAuthnAccountResponse
): boolean {
  if (
    !response ||
    typeof response.requestId !== 'string' ||
    (response.credentialId !== null && typeof response.credentialId !== 'string')
  ) {
    return false
  }
  const request = pendingAccountRequests.get(response.requestId)
  if (!request || request.renderer.id !== sender.id) {
    return false
  }
  if (response.credentialId !== null && !request.credentialIds.has(response.credentialId)) {
    return false
  }
  request.settle(response.credentialId)
  return true
}

export function cancelBrowserWebAuthnAccountRequests(browserPageId: string): void {
  for (const request of pendingAccountRequests.values()) {
    if (request.browserPageId === browserPageId) {
      request.settle(null)
    }
  }
}

export function cancelAllBrowserWebAuthnAccountRequests(): void {
  for (const request of pendingAccountRequests.values()) {
    request.settle(null)
  }
}
