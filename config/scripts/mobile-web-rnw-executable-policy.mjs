const runtimeCodeGenerationPattern = /\beval\s*\(|\bnew\s+Function\s*\(|sourceMappingURL/

const pagePersistencePatterns = [
  /\b(?:window\.)?(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem|clear|key)\b/,
  /\bindexedDB\s*\.\s*(?:open|deleteDatabase|databases)\b/,
  /\b(?:window\.)?caches\s*\.\s*(?:open|match|has|delete|keys)\b/,
  /\bdocument\s*\.\s*cookie\b/,
  /\bopenDatabase\s*\(/,
  /\bnavigator\s*\.\s*storage\s*\.\s*(?:getDirectory|persist|persisted)\b/
]

export function mobileWebRnwExecutablePolicyFailure(source) {
  if (runtimeCodeGenerationPattern.test(source)) {
    return 'runtime code generation'
  }
  if (pagePersistencePatterns.some((pattern) => pattern.test(source))) {
    return 'page-owned persistence'
  }
  return null
}

export function assertMobileWebRnwExecutablePolicy(source) {
  const failure = mobileWebRnwExecutablePolicyFailure(source)
  if (failure) {
    throw new Error(`RNW executable contains ${failure}`)
  }
}
