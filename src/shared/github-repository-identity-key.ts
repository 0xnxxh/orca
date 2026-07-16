// Why: cache keys and equality checks for GitHub repos must include the host,
// or a GHES repo and a same-named github.com repo would collide. github.com is
// omitted so pre-Enterprise host-less keys stay stable.
export function githubRepoIdentityKey(repo: {
  owner: string
  repo: string
  host?: string
}): string {
  const slug = `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`
  const host = repo.host?.toLowerCase()
  return host && host !== 'github.com' ? `${host}/${slug}` : slug
}
