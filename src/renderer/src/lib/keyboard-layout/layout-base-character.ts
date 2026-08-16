/**
 * Synchronous lookup of the active keyboard layout's characters with Option absent.
 *
 * Why: kitty keyboard CSI-u reports must carry the codepoint of the key in
 * the *current layout* with no modifiers. Deriving it from the physical code
 * alone assumes US QWERTY and reports the wrong key on Dvorak, Colemak,
 * AZERTY, QWERTZ, etc. — misfiring TUI hotkeys. Chromium supplies the base
 * layer; a native snapshot supplies Shift because the web API omits modifier layers.
 */
import type { LayoutMapLike } from './detect-option-as-alt'
import type {
  KeyboardLayoutKeyCharacters,
  KeyboardLayoutSnapshot
} from '../../../../shared/keyboard-layout-snapshot'

type NavigatorWithKeyboard = Navigator & {
  keyboard?: {
    getLayoutMap: () => Promise<LayoutMapLike>
  }
}

let cachedLayoutMap: LayoutMapLike | null = null
let cachedNativeKeyCharacters: Record<string, KeyboardLayoutKeyCharacters> | null = null
let focusListenerAttached = false
let refreshGeneration = 0

async function refreshLayoutMap(): Promise<void> {
  const generation = ++refreshGeneration
  const keyboard = (window.navigator as NavigatorWithKeyboard).keyboard
  const snapshotReader = (
    globalThis as {
      window?: {
        api?: { app?: { getKeyboardLayoutSnapshot?: () => Promise<KeyboardLayoutSnapshot | null> } }
      }
    }
  ).window?.api?.app?.getKeyboardLayoutSnapshot
  cachedNativeKeyCharacters = null
  const [layoutResult, snapshotResult] = await Promise.allSettled([
    keyboard?.getLayoutMap?.() ?? Promise.resolve(null),
    snapshotReader?.() ?? Promise.resolve(null)
  ])
  if (generation !== refreshGeneration) {
    return
  }
  if (layoutResult.status === 'fulfilled' && layoutResult.value) {
    cachedLayoutMap = layoutResult.value
  }
  if (snapshotResult.status === 'fulfilled' && snapshotResult.value) {
    cachedNativeKeyCharacters = snapshotResult.value.keyCharacters
  }
}

/** Idempotent. Kicks off the initial fetch and keeps the cache fresh across
 *  layout switches. Call from terminal keyboard setup so the map is resolved
 *  before the first Option chord. */
export function prefetchLayoutCharacters(): void {
  if (focusListenerAttached || typeof window === 'undefined') {
    return
  }
  focusListenerAttached = true
  window.addEventListener('focus', () => {
    void refreshLayoutMap()
  })
  void refreshLayoutMap()
}

/** A layout map entry is usable as a kitty base key only if it is a single
 *  printable codepoint (dead keys report names like 'Dead'; some entries are
 *  empty). Exposed for tests. */
export function normalizeLayoutBaseCharacter(value: string | undefined): string | undefined {
  return normalizeLayoutCharacter(value?.toLowerCase())
}

function normalizeLayoutCharacter(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const codePoints = [...value]
  if (codePoints.length !== 1) {
    return undefined
  }
  const codePoint = value.codePointAt(0) as number
  return codePoint <= 0x20 ? undefined : value
}

/** The active layout's unshifted character for a physical key code, or
 *  undefined when the map is unavailable or the key has no single printable
 *  base character (callers fall back to the US table). */
export function getLayoutBaseCharacterForCode(code: string): string | undefined {
  return normalizeLayoutBaseCharacter(
    cachedNativeKeyCharacters?.[code]?.unmodified ?? cachedLayoutMap?.get(code) ?? undefined
  )
}

/** Character produced by this layout with Shift optionally held and Option absent. */
export function getLayoutCharacterForCode(
  code: string,
  shifted: boolean,
  option = false
): string | undefined {
  if (option) {
    if (shifted) {
      return undefined
    }
    return normalizeLayoutCharacter(cachedNativeKeyCharacters?.[code]?.optionUnmodified)
  }
  if (!shifted) {
    return getLayoutBaseCharacterForCode(code)
  }
  const nativeShifted = normalizeLayoutCharacter(cachedNativeKeyCharacters?.[code]?.shifted)
  if (nativeShifted) {
    return nativeShifted
  }
  const base = getLayoutBaseCharacterForCode(code)
  if (!code.startsWith('Key') || !base) {
    return undefined
  }
  return normalizeLayoutCharacter(base.toUpperCase())
}

/** Test-only: replace or clear the cached layout map. */
export function _setLayoutMapForTests(map: LayoutMapLike | null): void {
  cachedLayoutMap = map
}

/** Test-only: replace or clear the native modifier-layer snapshot. */
export function _setLayoutSnapshotForTests(snapshot: KeyboardLayoutSnapshot | null): void {
  cachedNativeKeyCharacters = snapshot?.keyCharacters ?? null
}
