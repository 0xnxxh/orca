import { z } from 'zod'
import { OptionalString } from '../schemas'

export const IssueUpdate = z.object({
  state: z.enum(['open', 'closed']).optional(),
  title: OptionalString,
  body: OptionalString,
  addLabels: z.array(z.string()).optional(),
  removeLabels: z.array(z.string()).optional(),
  addAssignees: z.array(z.string()).optional(),
  removeAssignees: z.array(z.string()).optional()
})
