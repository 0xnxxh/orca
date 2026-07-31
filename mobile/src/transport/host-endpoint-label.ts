export function hostEndpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return endpoint
  }
}

export function hostEndpointRouteLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    const authority = `${url.hostname}${url.port ? `:${url.port}` : ''}`
    return `${authority}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return endpoint
  }
}
