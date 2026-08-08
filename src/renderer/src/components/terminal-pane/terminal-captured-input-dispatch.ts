import type { PtyTransport, PtyTransportInputTarget } from './pty-transport'

type CapturedTerminalInputDispatch = {
  targetPaneMounted: boolean
  currentTransport: PtyTransport | undefined
  capturedTransport: PtyTransport | undefined
  capturedPtyId: string | null
  capturedInputTarget?: PtyTransportInputTarget | null
  data: string
}

export type TerminalReconfirmationBinding = {
  requestWindowsShiftEnterReconfirmation?: () => void
}

export function sendCapturedTerminalInput({
  targetPaneMounted,
  currentTransport,
  capturedTransport,
  capturedPtyId,
  capturedInputTarget,
  data
}: CapturedTerminalInputDispatch): boolean {
  if (
    !targetPaneMounted ||
    !capturedTransport ||
    capturedPtyId === null ||
    currentTransport !== capturedTransport ||
    capturedTransport.getPtyId() !== capturedPtyId
  ) {
    return false
  }
  if (capturedInputTarget) {
    return capturedTransport.sendInputToTarget?.(capturedInputTarget, data) ?? false
  }
  return capturedTransport.sendInput(data)
}

export function requestCapturedTerminalReconfirmation(
  currentBinding: object | undefined,
  capturedBinding: TerminalReconfirmationBinding | undefined
): void {
  if (currentBinding === capturedBinding) {
    capturedBinding?.requestWindowsShiftEnterReconfirmation?.()
  }
}
