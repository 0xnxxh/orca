// Why: iOS smart punctuation can rewrite two ASCII hyphens into a single
// Unicode dash before React Native delivers terminal text input. Each dash maps
// to exactly "--": recovering longer runs (#5222) needed the previous controlled
// value written back into the field, and that write-back kills iOS dictation (#7925).
const IOS_SMART_DASH_REPLACEMENT_PATTERN = /[\u2013\u2014]/g

// Why: Apple text input hands back decomposed (NFD) text, so one Hangul syllable
// arrives as 2-3 conjoining jamo. The live mirror holds only the trailing code
// point, so every leading jamo would commit on its own (#6995 iOS). NFC — never
// NFKC, which rewrites compatibility jamo and full-width forms — recomposes them
// before the PTY sees anything; it is a no-op for already-composed input.
export function normalizeTerminalTextInput(text: string): string {
  return text.normalize('NFC').replace(IOS_SMART_DASH_REPLACEMENT_PATTERN, '--')
}
