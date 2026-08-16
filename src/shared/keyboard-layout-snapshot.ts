export type KeyboardLayoutKeyCharacters = {
  unmodified: string | null
  shifted: string | null
  optionUnmodified: string | null
}

export type KeyboardLayoutSnapshot = {
  inputSourceId: string | null
  keyCharacters: Record<string, KeyboardLayoutKeyCharacters>
}
