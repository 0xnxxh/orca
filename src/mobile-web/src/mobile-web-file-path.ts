export type MobileWebFileBreadcrumb = {
  label: string
  relativePath: string
}

export function joinMobileWebFilePath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name
}

export function mobileWebFileBreadcrumbs(relativePath: string): MobileWebFileBreadcrumb[] {
  const breadcrumbs: MobileWebFileBreadcrumb[] = [{ label: 'Workspace', relativePath: '' }]
  const segments = relativePath ? relativePath.split('/') : []
  let current = ''
  for (const segment of segments) {
    current = joinMobileWebFilePath(current, segment)
    breadcrumbs.push({ label: segment, relativePath: current })
  }
  return breadcrumbs
}
