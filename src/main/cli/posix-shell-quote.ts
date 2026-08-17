/** Single-quote a value for a POSIX shell, closing and reopening the quote
 *  around any embedded apostrophe. Shared by every generated launcher script so
 *  the CLI has one quoting rule instead of one per install method. */
export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
