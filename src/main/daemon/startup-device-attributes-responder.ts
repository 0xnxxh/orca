/**
 * Primary Device Attributes (DA1) responders for the daemon's headless emulator.
 *
 * Both callers answer DA1 on behalf of a renderer that cannot, and both consume
 * the query so the renderer's xterm never sees it and cannot double-reply:
 *
 * - ConPTY 1.22+ blocks at spawn awaiting a DA1 reply.
 * - The shell-ready barrier queues all inbound input until the ready marker,
 *   including the renderer's DA1 reply — and a shell that withholds its first
 *   prompt until DA1 is answered (fish waits 10s) never emits the marker that
 *   would release it. That caller's `reply` must write straight to the
 *   subprocess, past the queue, or the deadlock remains.
 */
import type { Terminal } from '@xterm/headless'

type DeviceAttributesParser = Pick<Terminal['parser'], 'registerCsiHandler'>

/** Matches what the renderer's xterm answers for xterm-* TERMs, so consuming the
 *  query upstream cannot change the capabilities a TUI sees. */
export const STARTUP_DA1_RESPONSE = '\x1b[?1;2c'

/** Returns a disposer so a caller scoped to startup can hand DA1 back to the
 *  renderer once its window closes. */
export function installDeviceAttributesResponder(deps: {
  parser: DeviceAttributesParser
  response: string
  reply: (data: string) => void
}): () => void {
  const handler = deps.parser.registerCsiHandler({ final: 'c' }, (params) => {
    // Why the param check: only DA1 is answered here. Secondary/tertiary variants
    // carry a prefix and must fall through to the renderer.
    const isPrimaryQuery = params.length === 0 || (params.length === 1 && params[0] === 0)
    if (!isPrimaryQuery) {
      return false
    }
    deps.reply(deps.response)
    return true
  })
  return () => handler.dispose()
}
