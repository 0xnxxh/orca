/** Break V8 SlicedString parent retention by forcing a fresh flat string. */
export function detachString(value: string): string {
  if (value.length === 0) {
    return ''
  }
  return ` ${value}`.slice(1)
}
