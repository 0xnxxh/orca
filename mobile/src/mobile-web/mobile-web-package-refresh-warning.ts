export function mobileWebPackageRefreshWarning(
  failureCode: string,
  hasHealthyInterface: boolean
): string {
  if (failureCode === 'incompatible_bridge') {
    return hasHealthyInterface
      ? 'Using the last healthy interface because the refreshed interface is not compatible with this Orca Mobile version.'
      : 'This desktop’s workspace interface is not compatible with this Orca Mobile version.'
  }
  return hasHealthyInterface
    ? 'Using the last healthy interface because the desktop package could not be refreshed.'
    : 'The desktop did not provide a valid workspace interface.'
}
