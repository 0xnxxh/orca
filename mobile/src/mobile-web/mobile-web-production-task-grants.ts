import type { MobileWebOperationGrant } from './mobile-web-production-grants'

export const MOBILE_WEB_PRODUCTION_TASK_GRANTS = [
  {
    capability: 'task',
    operation: 'bootstrap',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 128 * 1024,
      maxConcurrent: 1,
      rateCapacity: 4,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'task',
    operation: 'repositories',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 192 * 1024,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 2
    }
  },
  {
    capability: 'task',
    operation: 'linearContext',
    limits: {
      maxRequestBytes: 256,
      maxResponseBytes: 192 * 1024,
      maxConcurrent: 2,
      rateCapacity: 6,
      rateRefillPerSecond: 1
    }
  },
  {
    capability: 'task',
    operation: 'resolveRepoSlug',
    limits: {
      maxRequestBytes: 1024,
      maxResponseBytes: 1024,
      maxConcurrent: 4,
      rateCapacity: 20,
      rateRefillPerSecond: 5
    }
  },
  {
    capability: 'task',
    operation: 'updateResume',
    limits: {
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 20,
      rateRefillPerSecond: 5
    }
  },
  {
    capability: 'task',
    operation: 'updateSettings',
    limits: {
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 1,
      rateCapacity: 20,
      rateRefillPerSecond: 5
    }
  },
  ...['listGitHub', 'listGitLab', 'listGitLabTodos', 'listLinear'].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 4 * 1024,
          maxResponseBytes: 192 * 1024,
          maxConcurrent: 4,
          rateCapacity: 20,
          rateRefillPerSecond: 5
        }
      }) as MobileWebOperationGrant
  ),
  {
    capability: 'task',
    operation: 'countGitHub',
    limits: {
      maxRequestBytes: 4 * 1024,
      maxResponseBytes: 256,
      maxConcurrent: 4,
      rateCapacity: 20,
      rateRefillPerSecond: 5
    }
  },
  ...[
    'listGitHubLabels',
    'listGitHubAssignableUsers',
    'loadGitHubDetail',
    'loadGitLabDetail',
    'loadLinearDetail'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 4 * 1024,
          maxResponseBytes: 256 * 1024,
          maxConcurrent: 4,
          rateCapacity: 20,
          rateRefillPerSecond: 5
        }
      }) as MobileWebOperationGrant
  ),
  ...['listProjects', 'listProjectViews', 'resolveProjectRef'].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 8 * 1024,
          maxResponseBytes: 192 * 1024,
          maxConcurrent: 2,
          rateCapacity: 8,
          rateRefillPerSecond: 2
        }
      }) as MobileWebOperationGrant
  ),
  {
    capability: 'task',
    operation: 'projectTable',
    limits: {
      maxRequestBytes: 8 * 1024,
      maxResponseBytes: 192 * 1024,
      maxConcurrent: 1,
      rateCapacity: 12,
      rateRefillPerSecond: 3
    }
  },
  ...[
    'projectItemDetail',
    'projectItemLabels',
    'projectItemAssignableUsers',
    'projectIssueTypes'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 8 * 1024,
          maxResponseBytes: 256 * 1024,
          maxConcurrent: 4,
          rateCapacity: 20,
          rateRefillPerSecond: 5
        }
      }) as MobileWebOperationGrant
  ),
  ...[
    'updateProjectItem',
    'addProjectComment',
    'updateProjectComment',
    'deleteProjectComment',
    'updateProjectMetadata',
    'updateProjectField',
    'updateProjectIssueType',
    'resolveProjectReviewThread',
    'replyProjectReviewComment',
    'addProjectConversationComment',
    'requestProjectReviewers',
    'rerunProjectChecks',
    'mergeProjectPullRequest'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 72 * 1024,
          maxResponseBytes: 72 * 1024,
          maxConcurrent: 1,
          rateCapacity: 12,
          rateRefillPerSecond: 3
        }
      }) as MobileWebOperationGrant
  ),
  ...[
    'refreshProjectChecks',
    'setProjectFileViewed',
    'loadProjectFileContents',
    'addProjectInlineComment'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 72 * 1024,
          maxResponseBytes: 600 * 1024,
          maxConcurrent: 1,
          rateCapacity: 12,
          rateRefillPerSecond: 3
        }
      }) as MobileWebOperationGrant
  ),
  ...[
    'updateHostedTaskStatus',
    'updateHostedTaskMetadata',
    'addHostedTaskComment',
    'requestHostedTaskReviewers',
    'resolveHostedTaskReviewThread',
    'replyHostedTaskReviewComment',
    'mergeHostedTaskReview'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 72 * 1024,
          maxResponseBytes: 256,
          maxConcurrent: 1,
          rateCapacity: 12,
          rateRefillPerSecond: 3
        }
      }) as MobileWebOperationGrant
  ),
  ...[
    'refreshHostedTaskChecks',
    'rerunHostedTaskChecks',
    'setHostedTaskFileViewed',
    'addHostedTaskInlineComment'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 72 * 1024,
          maxResponseBytes: 72 * 1024,
          maxConcurrent: 1,
          rateCapacity: 12,
          rateRefillPerSecond: 3
        }
      }) as MobileWebOperationGrant
  ),
  {
    capability: 'task',
    operation: 'loadHostedTaskFileContents',
    limits: {
      maxRequestBytes: 8 * 1024,
      maxResponseBytes: 600 * 1024,
      maxConcurrent: 1,
      rateCapacity: 12,
      rateRefillPerSecond: 3
    }
  },
  ...[
    'connectLinear',
    'listLinearTeams',
    'listLinearTeamStates',
    'selectLinearWorkspace',
    'updateLinearIssueState',
    'addLinearIssueComment',
    'loadLinearIssue',
    'createLinearSubIssue',
    'createLinearIssue',
    'createProviderIssue',
    'updateIssueSource'
  ].map(
    (operation) =>
      ({
        capability: 'task',
        operation,
        limits: {
          maxRequestBytes: 72 * 1024,
          maxResponseBytes: 192 * 1024,
          maxConcurrent: 1,
          rateCapacity: 12,
          rateRefillPerSecond: 3
        }
      }) as MobileWebOperationGrant
  )
] as const satisfies readonly MobileWebOperationGrant[]
