import { isDeepStrictEqual } from 'node:util'
import {
  sameTerminalBinding,
  type TerminalPaneGeneration,
  type TerminalSessionBinding
} from './terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalAuthorityDurableOutcome,
  type TerminalAuthoritySemanticOutcome,
  type TerminalSessionAuthoritySemanticFact,
  type TerminalPaneAuthorityRecord
} from './terminal-session-authority-mutation'

const MAX_MATERIALIZED_BELLS = 99

export class TerminalSessionAuthorityMaterializedOutcomes {
  private readonly outcomes = new Map<string, TerminalAuthorityDurableOutcome>()
  private readonly bellKeys = new Map<string, string[]>()
  private retainedBytes = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number
  ) {}

  assertCanApply(outcome: TerminalAuthorityDurableOutcome): void {
    const change = this.planChange(outcome)
    if (
      this.outcomes.size - change.removed.length + change.added.length > this.maxEntries ||
      this.retainedBytes - byteLength(change.removed) + byteLength(change.added) > this.maxBytes
    ) {
      failTerminalSessionAuthority('capacity', 'materialized outcome projection is full')
    }
  }

  apply(outcome: TerminalAuthorityDurableOutcome): void {
    const change = this.planChange(outcome)
    this.applyChange(change)
  }

  restore(outcomes: readonly TerminalAuthorityDurableOutcome[]): void {
    let previousSequence = 0
    for (const outcome of outcomes) {
      if (outcome.sequence <= previousSequence) {
        failTerminalSessionAuthority(
          'record-corrupt',
          'materialized outcome projection is not ordered'
        )
      }
      this.assertCanApply(outcome)
      this.apply(outcome)
      previousSequence = outcome.sequence
    }
    if (!isDeepStrictEqual(this.projection(), outcomes)) {
      failTerminalSessionAuthority(
        'record-corrupt',
        'materialized outcome projection is not canonical'
      )
    }
  }

  projection(): readonly TerminalAuthorityDurableOutcome[] {
    return Object.freeze(
      [...this.outcomes.values()].sort((left, right) => left.sequence - right.sequence)
    )
  }

  private planChange(outcome: TerminalAuthorityDurableOutcome): MaterializedChange {
    if (outcome.kind === 'semantic') {
      return outcome.fact.kind === 'bell'
        ? this.planBell(outcome)
        : this.planReplacement(semanticKey(outcome), outcome)
    }
    if (outcome.result.kind === 'supersede') {
      return { removed: this.forPane(outcome.result.pane), added: [] }
    }
    const exit = outcome.result.effects.find((effect) => effect.kind === 'terminal-exited')
    return exit
      ? this.planReplacement(exitKey(outcome.result.pane, exit.binding), outcome)
      : EMPTY_CHANGE
  }

  private planBell(outcome: TerminalAuthoritySemanticOutcome): MaterializedChange {
    const binding = bindingKey(outcome.access.pane, outcome.access.binding)
    const keys = this.bellKeys.get(binding) ?? []
    const key = `${binding}\u0000bell\u0000${outcome.sequence}`
    const removed =
      keys.length >= MAX_MATERIALIZED_BELLS
        ? [{ key: keys[0]!, outcome: this.outcomes.get(keys[0]!)! }]
        : []
    return { removed, added: [{ key, outcome }] }
  }

  private planReplacement(
    key: string,
    outcome: TerminalAuthorityDurableOutcome
  ): MaterializedChange {
    const previous = this.outcomes.get(key)
    return { removed: previous ? [{ key, outcome: previous }] : [], added: [{ key, outcome }] }
  }

  private forPane(pane: TerminalPaneGeneration): MaterializedEntry[] {
    const prefix = `${paneKey(pane)}\u0000`
    return [...this.outcomes.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, outcome]) => ({ key, outcome }))
  }

  private applyChange(change: MaterializedChange): void {
    for (const { key, outcome } of change.removed) {
      this.delete(key, outcome)
    }
    for (const { key, outcome } of change.added) {
      this.outcomes.set(key, outcome)
      this.retainedBytes += outcome.byteLength
      if (outcome.kind === 'semantic' && outcome.fact.kind === 'bell') {
        const binding = bindingKey(outcome.access.pane, outcome.access.binding)
        const keys = this.bellKeys.get(binding) ?? []
        keys.push(key)
        this.bellKeys.set(binding, keys)
      }
    }
  }

  private delete(key: string, outcome: TerminalAuthorityDurableOutcome): void {
    this.outcomes.delete(key)
    this.retainedBytes -= outcome.byteLength
    if (outcome.kind !== 'semantic' || outcome.fact.kind !== 'bell') {
      return
    }
    const binding = bindingKey(outcome.access.pane, outcome.access.binding)
    const keys = this.bellKeys.get(binding)?.filter((candidate) => candidate !== key) ?? []
    if (keys.length === 0) {
      this.bellKeys.delete(binding)
    } else {
      this.bellKeys.set(binding, keys)
    }
  }
}

type MaterializedChange = Readonly<{
  removed: readonly MaterializedEntry[]
  added: readonly MaterializedEntry[]
}>

type MaterializedEntry = Readonly<{ key: string; outcome: TerminalAuthorityDurableOutcome }>

const EMPTY_CHANGE: MaterializedChange = Object.freeze({ removed: [], added: [] })

function semanticKey(outcome: TerminalAuthoritySemanticOutcome): string {
  return `${bindingKey(outcome.access.pane, outcome.access.binding)}\u0000${factDomain(outcome.fact)}`
}

function exitKey(pane: TerminalPaneGeneration, binding: TerminalSessionBinding): string {
  return `${bindingKey(pane, binding)}\u0000exit`
}

function bindingKey(pane: TerminalPaneGeneration, binding: TerminalSessionBinding): string {
  return `${paneKey(pane)}\u0000${JSON.stringify([
    binding.ownerIncarnationId,
    binding.physicalPtyId,
    binding.ptyIncarnationId
  ])}`
}

function paneKey(pane: TerminalPaneGeneration): string {
  return JSON.stringify([pane.paneKey, pane.paneGenerationId])
}

function factDomain(fact: TerminalSessionAuthoritySemanticFact): string {
  if (fact.kind === '2031-subscribe' || fact.kind === '2031-unsubscribe') {
    return '2031-subscription'
  }
  return fact.kind
}

function byteLength(entries: readonly MaterializedEntry[]): number {
  return entries.reduce((total, entry) => total + entry.outcome.byteLength, 0)
}

export function terminalAuthorityMaterializedOutcomeBinding(
  outcome: TerminalAuthorityDurableOutcome
): Readonly<{ pane: TerminalPaneGeneration; binding: TerminalSessionBinding }> | null {
  if (outcome.kind === 'semantic') {
    return { pane: outcome.access.pane, binding: outcome.access.binding }
  }
  const exit = outcome.result.effects.find((effect) => effect.kind === 'terminal-exited')
  return exit ? { pane: outcome.result.pane, binding: exit.binding } : null
}

export function terminalAuthorityMaterializedOutcomeMatchesBinding(
  outcome: TerminalAuthorityDurableOutcome,
  pane: TerminalPaneGeneration,
  binding: TerminalSessionBinding
): boolean {
  const materialized = terminalAuthorityMaterializedOutcomeBinding(outcome)
  return Boolean(
    materialized &&
    materialized.pane.paneKey === pane.paneKey &&
    materialized.pane.paneGenerationId === pane.paneGenerationId &&
    sameTerminalBinding(materialized.binding, binding)
  )
}

export function assertTerminalAuthorityMaterializedOutcomesMatchTopology(
  outcomes: readonly TerminalAuthorityDurableOutcome[],
  pane: (generation: TerminalPaneGeneration) => TerminalPaneAuthorityRecord | null
): void {
  for (const outcome of outcomes) {
    const materialized = terminalAuthorityMaterializedOutcomeBinding(outcome)
    const currentPane = materialized ? pane(materialized.pane) : null
    const binding = currentPane?.binding ?? currentPane?.lastBinding ?? null
    if (
      !materialized ||
      !currentPane ||
      !binding ||
      !terminalAuthorityMaterializedOutcomeMatchesBinding(outcome, currentPane, binding)
    ) {
      failTerminalSessionAuthority(
        'record-corrupt',
        'materialized outcome lost its exact pane binding'
      )
    }
  }
}
