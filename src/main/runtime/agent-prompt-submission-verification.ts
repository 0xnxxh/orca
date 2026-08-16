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
  signal?: AbortSignal
}

type AgentPromptEffect = 'working' | 'permission' | 'activity' | 'none'

export async function verifyAgentPromptSubmission(
  options: AgentPromptVerificationOptions
): Promise<{ retried: boolean }> {
  throwIfAgentPromptAborted(options.signal)
  if (options.baseline.status === 'permission') {
    throw new Error('agent_prompt_blocked')
  }
  if (options.baseline.status === 'working') {
    return { retried: false }
  }
  const firstEffect = await waitForAgentPromptEffect(
    options.baseline,
    options.readActivity,
    options.signal
  )
  if (firstEffect === 'permission') {
    throw new Error('agent_prompt_blocked')
  }
  if (firstEffect === 'working') {
    return { retried: false }
  }

  const proofActivity = options.readActivity()
  assertSamePromptGeneration(options.baseline, proofActivity)
  assertPromptNotBlocked(proofActivity)
  const textBeforeCursor = await options.readTextBeforeCursor()
  const activityAfterProof = options.readActivity()
  assertSamePromptGeneration(options.baseline, activityAfterProof)
  assertPromptNotBlocked(activityAfterProof)
  if (agentPromptActivityChanged(options.baseline, activityAfterProof)) {
    if (activityAfterProof.status === 'working') {
      return { retried: false }
    }
    if (!textBeforeCursorEndsWithPrompt(textBeforeCursor, options.prompt)) {
      return { retried: false }
    }
  }
  if (!textBeforeCursorEndsWithPrompt(textBeforeCursor, options.prompt)) {
    throw new Error('agent_prompt_stalled')
  }

  throwIfAgentPromptAborted(options.signal)
  const retry = await options.retrySubmit(activityAfterProof)
  if (retry === 'activity') {
    return { retried: false }
  }
  const retryEffect = await waitForAgentPromptEffect(
    activityAfterProof,
    options.readActivity,
    options.signal
  )
  if (retryEffect === 'permission') {
    throw new Error('agent_prompt_blocked')
  }
  if (retryEffect === 'working') {
    return { retried: true }
  }
  if (retryEffect === 'none') {
    throw new Error('agent_prompt_stalled')
  }
  const retryTextBeforeCursor = await options.readTextBeforeCursor()
  if (textBeforeCursorEndsWithPrompt(retryTextBeforeCursor, options.prompt)) {
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
    current.outputSequence !== baseline.outputSequence ||
    current.status !== baseline.status
  )
}

export function textBeforeCursorEndsWithPrompt(
  textBeforeCursor: string | null,
  prompt: string
): boolean {
  if (!textBeforeCursor) {
    return false
  }
  const expected = sanitizeAgentPromptText(prompt)
  return expected.length > 0 && textBeforeCursor.endsWith(expected)
}

async function waitForAgentPromptEffect(
  baseline: AgentPromptActivity,
  readActivity: () => AgentPromptActivity,
  signal?: AbortSignal
): Promise<AgentPromptEffect> {
  const deadline = Date.now() + AGENT_PROMPT_EFFECT_TIMEOUT_MS
  let activityObserved = false
  while (Date.now() < deadline) {
    throwIfAgentPromptAborted(signal)
    const current = readActivity()
    assertSamePromptGeneration(baseline, current)
    if (current.status === 'permission') {
      return 'permission'
    }
    if (current.status === 'working') {
      return 'working'
    }
    if (agentPromptActivityChanged(baseline, current)) {
      activityObserved = true
    }
    await waitForAgentPromptPoll(signal)
  }
  const current = readActivity()
  assertSamePromptGeneration(baseline, current)
  if (current.status === 'permission') {
    return 'permission'
  }
  if (current.status === 'working') {
    return 'working'
  }
  return activityObserved || agentPromptActivityChanged(baseline, current) ? 'activity' : 'none'
}

function assertSamePromptGeneration(
  baseline: AgentPromptActivity,
  current: AgentPromptActivity
): void {
  if (current.generation !== baseline.generation) {
    throw new Error('terminal_handle_stale')
  }
}

function assertPromptNotBlocked(activity: AgentPromptActivity): void {
  if (activity.status === 'permission') {
    throw new Error('agent_prompt_blocked')
  }
}

function throwIfAgentPromptAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('request_aborted')
  }
}

async function waitForAgentPromptPoll(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, AGENT_PROMPT_EFFECT_POLL_MS))
    return
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('request_aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, AGENT_PROMPT_EFFECT_POLL_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
}
