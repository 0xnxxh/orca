import { sanitizeAgentPromptText } from '../../shared/agent-prompt-injection'

export const AGENT_PROMPT_EFFECT_TIMEOUT_MS = 5_000
const AGENT_PROMPT_EFFECT_POLL_MS = 50

export type AgentPromptActivity = Readonly<{
  generation: number
  lifecycleSequence: number
  outputSequence: number
  status: 'working' | 'permission' | 'idle' | null
}>

type AgentPromptVerificationOptions = {
  baseline: AgentPromptActivity
  prompt: string
  readActivity: () => AgentPromptActivity
  readTextBeforeCursor: () => Promise<string | null>
  retrySubmit: (expected: AgentPromptActivity) => Promise<'retried' | 'activity'>
}

export async function verifyAgentPromptSubmission(
  options: AgentPromptVerificationOptions
): Promise<{ retried: boolean }> {
  if (options.baseline.status === 'working') {
    return { retried: false }
  }
  if (await waitForAgentPromptActivity(options.baseline, options.readActivity)) {
    return { retried: false }
  }

  const proofActivity = options.readActivity()
  assertSamePromptGeneration(options.baseline, proofActivity)
  const textBeforeCursor = await options.readTextBeforeCursor()
  const activityAfterProof = options.readActivity()
  assertSamePromptGeneration(options.baseline, activityAfterProof)
  if (agentPromptActivityChanged(options.baseline, activityAfterProof)) {
    return { retried: false }
  }
  if (!textBeforeCursorEndsWithPrompt(textBeforeCursor, options.prompt)) {
    throw new Error('agent_prompt_stalled')
  }

  const retry = await options.retrySubmit(activityAfterProof)
  if (retry === 'activity') {
    return { retried: false }
  }
  if (!(await waitForAgentPromptActivity(activityAfterProof, options.readActivity))) {
    throw new Error('agent_prompt_stalled')
  }
  return { retried: true }
}

export function agentPromptActivityChanged(
  baseline: AgentPromptActivity,
  current: AgentPromptActivity
): boolean {
  return (
    current.lifecycleSequence !== baseline.lifecycleSequence ||
    current.outputSequence !== baseline.outputSequence
  )
}

export function textBeforeCursorEndsWithPrompt(
  textBeforeCursor: string | null,
  prompt: string
): boolean {
  if (!textBeforeCursor) {
    return false
  }
  const expected = normalizeTerminalComposerText(sanitizeAgentPromptText(prompt))
  return expected.length > 0 && normalizeTerminalComposerText(textBeforeCursor).endsWith(expected)
}

async function waitForAgentPromptActivity(
  baseline: AgentPromptActivity,
  readActivity: () => AgentPromptActivity
): Promise<boolean> {
  const deadline = Date.now() + AGENT_PROMPT_EFFECT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const current = readActivity()
    assertSamePromptGeneration(baseline, current)
    if (agentPromptActivityChanged(baseline, current)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, AGENT_PROMPT_EFFECT_POLL_MS))
  }
  const current = readActivity()
  assertSamePromptGeneration(baseline, current)
  return agentPromptActivityChanged(baseline, current)
}

function assertSamePromptGeneration(
  baseline: AgentPromptActivity,
  current: AgentPromptActivity
): void {
  if (current.generation !== baseline.generation) {
    throw new Error('terminal_handle_stale')
  }
}

function normalizeTerminalComposerText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}
