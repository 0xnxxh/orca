import type { MobileWebBridgeClient } from '../../../src/mobile-web/src/mobile-web-bridge-client'

type RequestParams = Record<string, unknown>

export async function handleWebHostProviderReviewCreation(args: {
  client: MobileWebBridgeClient
  workspaceId: string
  method: string
  params: RequestParams
}): Promise<unknown | typeof WEB_HOST_PROVIDER_REVIEW_CREATION_UNHANDLED> {
  if (
    args.method !== 'hostedReview.getCreationEligibility' &&
    args.method !== 'hostedReview.create' &&
    args.method !== 'git.generatePullRequestFields'
  ) {
    return WEB_HOST_PROVIDER_REVIEW_CREATION_UNHANDLED
  }
  const status = await args.client.sourceControlStatus({
    workspaceId: args.workspaceId,
    limit: 64
  })
  if (!status.head || !status.branch) {
    throw new Error('conflict')
  }
  const identity = {
    workspaceId: args.workspaceId,
    expectedHead: status.head,
    expectedBranch: status.branch
  }
  if (args.method === 'hostedReview.getCreationEligibility') {
    const result = await args.client.providerReviewCreationEligibility({
      ...identity,
      ...(args.params.base === null || args.params.base === undefined
        ? {}
        : { base: requiredString(args.params.base) })
    })
    const {
      workspaceId: _workspaceId,
      observedHead: _observedHead,
      branch: _branch,
      ...eligibility
    } = result
    return eligibility
  }
  if (args.method === 'git.generatePullRequestFields') {
    const result = await args.client.providerReviewGenerateFields({
      ...identity,
      base: requiredString(args.params.base),
      title: optionalString(args.params.title),
      body: optionalString(args.params.body),
      draft: args.params.draft === true
    })
    const { workspaceId: _workspaceId, ...fields } = result
    return fields
  }
  const result = await args.client.providerReviewCreate({
    ...identity,
    provider: requiredProvider(args.params.provider),
    base: requiredString(args.params.base),
    ...(args.params.head === undefined ? {} : { head: requiredString(args.params.head) }),
    title: requiredString(args.params.title),
    body: optionalString(args.params.body),
    draft: args.params.draft === true,
    ...(args.params.useTemplate === undefined
      ? {}
      : { useTemplate: requiredBoolean(args.params.useTemplate) })
  })
  const { workspaceId: _workspaceId, provider: _provider, ...created } = result
  return created
}

export const WEB_HOST_PROVIDER_REVIEW_CREATION_UNHANDLED = Symbol(
  'provider-review-creation-unhandled'
)

function requiredProvider(
  value: unknown
): 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea' {
  if (
    value !== 'github' &&
    value !== 'gitlab' &&
    value !== 'bitbucket' &&
    value !== 'azure-devops' &&
    value !== 'gitea'
  ) {
    throw new Error('invalid_request')
  }
  return value
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('invalid_request')
  }
  return value.trim()
}

function optionalString(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  if (typeof value !== 'string') {
    throw new Error('invalid_request')
  }
  return value
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('invalid_request')
  }
  return value
}
