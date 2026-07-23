// Why: fill-mode sheets need a stable outer height so docked chrome (e.g. the
// smart-source TextInput) does not ride result-list reflow. Height shrinks by
// the keyboard inset; the sheet is also lifted with marginBottom equal to that
// inset so the bottom edge sits on the keyboard top (height shrink alone still
// leaves the dock in the keyboard footprint).

export function resolveBottomDrawerFillHeight(input: {
  screenHeight: number
  topInset: number
  keyboardInset: number
  topGap?: number
  minHeight?: number
}): number {
  const topGap = input.topGap ?? 16
  const minHeight = input.minHeight ?? 280
  const keyboardInset = Math.max(0, input.keyboardInset)
  return Math.max(minHeight, input.screenHeight - input.topInset - topGap - keyboardInset)
}
