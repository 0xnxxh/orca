// Parser output is cached on disk across app versions: if a change here alters
// how records are coerced for every parser, bump PARSER_REVISION in
// session-parse-cache-persistence.ts or stale sessions are served from disk.
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
