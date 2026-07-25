import type { RpcClient } from '../transport/rpc-client'
import { pasteMobileNativeChatImagePaths } from './mobile-native-chat-image-send'

// The condition tracked here — a bracketed image paste left sitting on the agent's
// unsubmitted input line — lives on the HOST terminal, so it outlives any one
// session screen. Keyed by terminal handle at module scope: React state died with
// the screen and let the orphaned paste glue onto the next message (#10228).
const staleInputTerminals = new Set<string>()

export function markMobileNativeChatInputStale(terminal: string): void {
  staleInputTerminals.add(terminal)
}

export function isMobileNativeChatInputStale(terminal: string): boolean {
  return staleInputTerminals.has(terminal)
}

export function clearMobileNativeChatInputStale(terminal: string): void {
  staleInputTerminals.delete(terminal)
}

/** Test-only: module scope outlives a single test's hooks. */
export function resetMobileNativeChatStaleInputForTests(): void {
  staleInputTerminals.clear()
}

/** Clears a marked terminal's unsubmitted input line before a write that could
 *  submit it, consuming the marker only once the host accepts the clear.
 *
 *  Returns true when the line is safe to submit (nothing marked, or cleared);
 *  false when a needed clear failed — the marker stays set for the next attempt
 *  and the caller must not submit, or the stale paste rides along with it.
 *
 *  Only for writes that can commit the composer. Pure dialog control (permission
 *  choices, Escape) is `enter: false` against an overlay that swallows the keys,
 *  so a clear there would not reach the input line yet would still consume the
 *  marker — leaving the next real message to be corrupted by the paste. */
export async function healMobileNativeChatStaleInput(args: {
  readonly client: Pick<RpcClient, 'sendRequest'>
  readonly terminal: string
  readonly deviceToken: string | null
}): Promise<boolean> {
  if (!isMobileNativeChatInputStale(args.terminal)) {
    return true
  }
  let cleared = false
  try {
    cleared = await pasteMobileNativeChatImagePaths({
      client: args.client,
      terminal: args.terminal,
      deviceToken: args.deviceToken,
      imagePaths: []
    })
  } catch {
    // Leave marked for the next attempt.
    return false
  }
  if (!cleared) {
    return false
  }
  clearMobileNativeChatInputStale(args.terminal)
  return true
}
