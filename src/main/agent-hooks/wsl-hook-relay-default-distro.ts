export async function resolveWslHookRelayDefaultDistro(
  cached: string | null,
  listDistros: () => Promise<string[]>
): Promise<string | null> {
  if (cached) {
    return cached
  }
  try {
    return (await listDistros())[0] ?? null
  } catch {
    return null
  }
}
