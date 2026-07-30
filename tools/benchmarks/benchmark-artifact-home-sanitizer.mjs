import os from 'node:os'

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimHomePath(home) {
  return home.replace(/[\\/]+$/, '')
}

function homePathVariants(home) {
  if (home === '/' || /^[A-Za-z]:[\\/]+$/.test(home)) {
    return []
  }
  const trimmedHome = trimHomePath(home)
  const variants = new Set([trimmedHome])
  if (/^[A-Za-z]:[\\/]/.test(trimmedHome)) {
    variants.add(trimmedHome.replaceAll('\\', '/'))
    variants.add(trimmedHome.replaceAll('/', '\\'))
  }
  return [...variants].filter(Boolean).sort((a, b) => b.length - a.length)
}

function sanitizeArtifactString(value, homes) {
  let sanitized = value
  for (const home of homes) {
    const boundary = /[\\/]$/.test(home) ? '' : '(?![A-Za-z0-9._-])'
    const flags = /^[A-Za-z]:[\\/]/.test(home) ? 'gi' : 'g'
    sanitized = sanitized.replace(
      new RegExp(`${escapeRegularExpression(home)}${boundary}`, flags),
      '~'
    )
  }
  return sanitized
}

export function sanitizeBenchmarkArtifactHomePaths(value, home = os.homedir()) {
  const homes = homePathVariants(home)

  function sanitizeNestedValue(nestedValue) {
    if (typeof nestedValue === 'string') {
      return sanitizeArtifactString(nestedValue, homes)
    }
    if (Array.isArray(nestedValue)) {
      return nestedValue.map(sanitizeNestedValue)
    }
    if (nestedValue !== null && typeof nestedValue === 'object') {
      return Object.fromEntries(
        Object.entries(nestedValue).map(([key, entry]) => [key, sanitizeNestedValue(entry)])
      )
    }
    return nestedValue
  }

  return sanitizeNestedValue(value)
}
