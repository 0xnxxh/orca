// Why hoisted: localeCompare with an options object resolves a fresh ICU collator
// on every comparison, so a directory sort paid for one per O(n log n) step.
// numeric: true orders "99 - a" before "100 - b", matching Finder/Explorer.
export const fileNameCollator = new Intl.Collator(undefined, { numeric: true })

export function compareFileNames(a: string, b: string): number {
  return fileNameCollator.compare(a, b)
}
