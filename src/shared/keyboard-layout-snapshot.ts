export type KeyboardLayoutKeyCharacters = {
  unmodified: string | null
  shifted: string | null
  optionUnmodified: string | null
  optionShifted?: string | null
}

export type KeyboardLayoutSnapshot = {
  inputSourceId: string | null
  layoutSourceId?: string | null
  keyCharacters: Record<string, KeyboardLayoutKeyCharacters>
}
