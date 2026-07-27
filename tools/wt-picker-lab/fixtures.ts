import type { NewWorkspaceProjectOption } from './design-contract'

/**
 * Realistic option set: provider-backed projects, path-detail duplicates, and
 * folder groups — the mix that makes the current picker feel heavy.
 */
export const LAB_PROJECT_OPTIONS: NewWorkspaceProjectOption[] = [
  {
    kind: 'project',
    id: 'p-orca',
    projectId: 'p-orca',
    displayName: 'orca',
    badgeColor: '#7c8cf8',
    detail: 'orca-labs/orca'
  },
  {
    kind: 'project',
    id: 'p-orca-relay',
    projectId: 'p-orca-relay',
    displayName: 'orca-relay',
    badgeColor: '#4fb286',
    detail: 'orca-labs/orca-relay'
  },
  {
    kind: 'project',
    id: 'p-orca-docs',
    projectId: 'p-orca-docs',
    displayName: 'orca-docs',
    badgeColor: '#e0a458',
    detail: 'orca-labs/orca-docs'
  },
  {
    kind: 'project',
    id: 'p-api-gateway',
    projectId: 'p-api-gateway',
    displayName: 'api-gateway',
    badgeColor: '#d16b86',
    detail: 'acme-corp/api-gateway'
  },
  {
    kind: 'project',
    id: 'p-billing',
    projectId: 'p-billing',
    displayName: 'billing-service',
    badgeColor: '#6bb3d1',
    detail: 'acme-corp/billing-service'
  },
  {
    kind: 'project',
    id: 'p-design-system',
    projectId: 'p-design-system',
    displayName: 'design-system',
    badgeColor: '#b06bd1',
    detail: 'acme-corp/design-system'
  },
  // Duplicate display name: detail falls back to the setup directory + host.
  {
    kind: 'project',
    id: 'p-scratch-local',
    projectId: 'p-scratch-local',
    displayName: 'scratch',
    badgeColor: '#8c8c8c',
    detail: '~/code/scratch'
  },
  {
    kind: 'project',
    id: 'p-scratch-remote',
    projectId: 'p-scratch-remote',
    displayName: 'scratch',
    badgeColor: '#8c8c8c',
    detail: '~/src/scratch · devbox'
  },
  {
    kind: 'project',
    id: 'p-infra',
    projectId: 'p-infra',
    displayName: 'infra-terraform',
    badgeColor: '#5f9ea0',
    detail: '3 hosts configured'
  },
  {
    kind: 'project',
    id: 'p-mobile',
    projectId: 'p-mobile',
    displayName: 'orca-mobile',
    badgeColor: '#c97b4a',
    detail: 'orca-labs/orca-mobile'
  },
  {
    kind: 'project',
    id: 'p-notebooks',
    projectId: 'p-notebooks',
    displayName: 'research-notebooks',
    badgeColor: '#7aa874',
    detail: 'Project'
  },
  {
    kind: 'project-group',
    id: 'project-group:g-clients',
    projectGroupId: 'g-clients',
    displayName: 'Client work',
    badgeColor: '#9a8cf8',
    detail: '~/work/clients',
    parentPath: '~/work/clients',
    connectionId: null
  },
  {
    kind: 'project-group',
    id: 'project-group:g-experiments',
    projectGroupId: 'g-experiments',
    displayName: 'Experiments',
    badgeColor: '#d1a26b',
    detail: '~/work/experiments',
    parentPath: '~/work/experiments',
    connectionId: null
  }
]

/** Most-recent-first project ids — designs may use this for recency ordering. */
export const LAB_RECENT_PROJECT_IDS: readonly string[] = [
  'p-orca',
  'p-api-gateway',
  'p-design-system',
  'p-orca-relay'
]

/** A single-project workspace, to check the degenerate case. */
export const LAB_SINGLE_PROJECT_OPTIONS: NewWorkspaceProjectOption[] = [LAB_PROJECT_OPTIONS[0]]

/**
 * Truncation stress: names and paths well past the 512px dialog. Covers the
 * cases that break differently — a long name with a short detail, a short name
 * with a deep path, both long at once, a long unbroken token with no wrap
 * opportunity, and two long names identical until their final segment (so the
 * disambiguating text is exactly what a naive `truncate` throws away).
 */
export const LAB_LONG_NAME_PROJECT_OPTIONS: NewWorkspaceProjectOption[] = [
  {
    kind: 'project',
    id: 'p-long-name',
    projectId: 'p-long-name',
    displayName: 'orca-platform-infrastructure-provisioning-service',
    badgeColor: '#7c8cf8',
    detail: 'acme-corp/orca-platform-infrastructure-provisioning-service'
  },
  {
    kind: 'project',
    id: 'p-deep-path',
    projectId: 'p-deep-path',
    displayName: 'gateway',
    badgeColor: '#4fb286',
    detail: '~/Developer/work/acme-corp/monorepo/packages/services/edge/gateway'
  },
  {
    kind: 'project',
    id: 'p-both-long',
    projectId: 'p-both-long',
    displayName: 'internal-developer-platform-control-plane',
    badgeColor: '#d16b86',
    detail: '~/Developer/acme/platform/internal-developer-platform-control-plane · eu-west-build-01'
  },
  {
    kind: 'project',
    id: 'p-unbroken',
    projectId: 'p-unbroken',
    displayName: 'averyverylongunbrokenrepositorynamewithnoseparatorsatall',
    badgeColor: '#e0a458',
    detail: 'acme-corp/averyverylongunbrokenrepositorynamewithnoseparatorsatall'
  },
  // Differ only in the last path segment: truncating the tail makes them identical.
  {
    kind: 'project',
    id: 'p-tail-a',
    projectId: 'p-tail-a',
    displayName: 'checkout',
    badgeColor: '#b06bd1',
    detail: '~/Developer/work/acme-corp/monorepo/packages/services/checkout-web'
  },
  {
    kind: 'project',
    id: 'p-tail-b',
    projectId: 'p-tail-b',
    displayName: 'checkout',
    badgeColor: '#6bb3d1',
    detail: '~/Developer/work/acme-corp/monorepo/packages/services/checkout-api'
  },
  {
    kind: 'project-group',
    id: 'project-group:g-long',
    projectGroupId: 'g-long',
    displayName: 'Acme Corporation — Platform Engineering Experiments',
    badgeColor: '#9a8cf8',
    detail: '~/Developer/work/acme-corp/platform-engineering/experiments',
    parentPath: '~/Developer/work/acme-corp/platform-engineering/experiments',
    connectionId: null
  },
  ...LAB_PROJECT_OPTIONS.slice(0, 3)
]
