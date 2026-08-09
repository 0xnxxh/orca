/** True when a portaled Radix menu click re-bubbles through a row's React tree. */
export function isPortaledRowMenuClick(event: {
  target: EventTarget
  currentTarget: EventTarget
}): boolean {
  const target = event.target
  return target instanceof Node && event.currentTarget instanceof Node
    ? !event.currentTarget.contains(target)
    : false
}
