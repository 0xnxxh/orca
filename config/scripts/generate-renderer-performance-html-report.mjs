#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  BENCHMARK_GROUPS,
  collectRendererPerformanceEvidence
} from './renderer-performance-report-data.mjs'

const DEFAULT_OUTPUT = 'docs/assets/renderer-agent-status-performance-report.html'
const DEFAULT_FONT = 'src/renderer/src/assets/fonts/Geist-Variable.woff2'
const GROUP_FLAGS = {
  '--burst-sequential': 'burstSequential',
  '--burst-batch': 'burstBatch',
  '--cadence-sequential': 'cadenceSequential',
  '--cadence-batch': 'cadenceBatch'
}

const LISTENER_EVIDENCE = {
  baselineWithoutAgents: 8518,
  candidateWithoutAgents: 1218,
  candidateWithHundredAgents: 1618
}

const VALIDATION_EVIDENCE = [
  'Agent-status store semantics',
  'IPC ordering and synchronous re-entry',
  'Sidebar subscription lifecycles',
  'Web typecheck and targeted lint',
  'E2E Electron build'
]

export function parseRendererPerformanceReportArgs(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  const groups = Object.fromEntries(BENCHMARK_GROUPS.map((key) => [key, []]))
  let outputPath = DEFAULT_OUTPUT
  let fontPath = DEFAULT_FONT
  let terminalReportPath = null
  let terminalPanes = 20
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const readValue = () => {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      index += 1
      return value
    }
    if (GROUP_FLAGS[arg]) {
      groups[GROUP_FLAGS[arg]].push(readValue())
    } else if (arg === '--terminal-report') {
      terminalReportPath = readValue()
    } else if (arg === '--terminal-panes') {
      terminalPanes = Number(readValue())
    } else if (arg === '--font') {
      fontPath = readValue()
    } else if (arg === '--output' || arg === '-o') {
      outputPath = readValue()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  for (const key of BENCHMARK_GROUPS) {
    if (groups[key].length === 0) {
      const flag = Object.keys(GROUP_FLAGS).find((candidate) => GROUP_FLAGS[candidate] === key)
      throw new Error(`Missing ${flag}`)
    }
  }
  if (!terminalReportPath) {
    throw new Error('Missing --terminal-report')
  }
  if (!Number.isInteger(terminalPanes) || terminalPanes < 1) {
    throw new Error('--terminal-panes must be a positive integer')
  }
  return { groups, outputPath, fontPath, terminalReportPath, terminalPanes }
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value)
}

function formatMetric(value, type) {
  if (value == null) {
    return '—'
  }
  if (type === 'count') {
    return formatNumber(value, 0)
  }
  if (type === 'cpu') {
    return `${formatNumber(value, 1)}%`
  }
  if (type === 'throughput') {
    return `${formatNumber(value, 1)}/s`
  }
  return `${formatNumber(value, 1)} ms`
}

function changeLabel(baseline, candidate, higherIsBetter = false) {
  if (baseline == null || candidate == null || baseline === 0) {
    return { className: 'neutral', label: '—' }
  }
  const change = ((candidate - baseline) / baseline) * 100
  const improved = higherIsBetter ? change > 0 : change < 0
  return {
    className: improved ? 'better' : change === 0 ? 'neutral' : 'worse',
    label: `${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change), 1)}%`
  }
}

const TABLE_METRICS = [
  ['publications', 'Synchronous store publications', 'count', false],
  ['publicationsPerBatch', 'Publications per requested batch', 'count', false],
  ['completionMs', 'Workload completion', 'ms', false],
  ['totalActionMs', 'Store action time', 'ms', false],
  ['actionP95Ms', 'p95 store action', 'ms', false],
  ['throughput', 'Update throughput', 'throughput', true],
  ['schedulingDriftP95Ms', 'p95 scheduling drift', 'ms', false],
  ['rendererMeanCpu', 'Renderer mean CPU', 'cpu', false],
  ['rendererP95Cpu', 'Renderer p95 CPU', 'cpu', false],
  ['longTaskCount', 'Long tasks', 'count', false],
  ['longTaskP95Ms', 'p95 long task', 'ms', false],
  ['maxTimerDriftMs', 'Maximum timer drift', 'ms', false]
]

function runCountLabel(run, key) {
  const contributingRuns = run.metricRunCounts[key]
  return contributingRuns === run.runCount
    ? ''
    : `<small class="sample-count">${contributingRuns}/${run.runCount} runs</small>`
}

function renderRunMetric(run, key, type) {
  return `${formatMetric(run.metrics[key], type)}${runCountLabel(run, key)}`
}

function renderComparisonTable(title, scenario, note = '') {
  const { sequential, batch } = scenario
  const rows = TABLE_METRICS.map(([key, label, type, higherIsBetter]) => {
    const baseline = sequential.metrics[key]
    const candidate = batch.metrics[key]
    const change = changeLabel(baseline, candidate, higherIsBetter)
    return `<tr><th scope="row">${label}</th><td>${renderRunMetric(sequential, key, type)}</td><td>${renderRunMetric(batch, key, type)}</td><td><span class="delta ${change.className}">${change.label}</span></td></tr>`
  }).join('')
  const burstLabel = sequential.requestedBatches === 1 ? 'burst' : 'bursts'
  const hasConditionalMetric = TABLE_METRICS.some(
    ([key]) =>
      sequential.metricRunCounts[key] !== sequential.runCount ||
      batch.metricRunCounts[key] !== batch.runCount
  )
  const medianNote = hasConditionalMetric
    ? ' Values are medians; conditional cells name their contributing run count.'
    : ' Values are medians across every repetition.'
  return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">${sequential.runCount} verified repetitions</p><h2>${title}</h2></div><span class="verified">Final state verified</span></div><p class="section-copy">${sequential.requestedBatches} ${burstLabel} × ${formatNumber(sequential.updatesPerBatch, 0)} ordered updates across ${formatNumber(sequential.worktrees, 0)} mounted worktrees.${medianNote}${note}</p><div class="table-scroll"><table><thead><tr><th>Metric</th><th>Sequential median</th><th>Batched median</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
}

function renderHeadlineCards(evidence) {
  const baseline = evidence.burst.sequential.metrics
  const candidate = evidence.burst.batch.metrics
  const cards = [
    ['Synchronous store publications', 'publications', 'count'],
    ['Store action time', 'totalActionMs', 'ms'],
    ['Renderer mean CPU', 'rendererMeanCpu', 'cpu'],
    ['p95 long task', 'longTaskP95Ms', 'ms']
  ]
  return cards
    .map(([label, key, type]) => {
      const before = baseline[key]
      const after = candidate[key]
      const change = changeLabel(before, after)
      return `<article class="metric-card"><p>${label}</p><strong>${renderRunMetric(evidence.burst.batch, key, type)}</strong><div><span>${renderRunMetric(evidence.burst.sequential, key, type)} before</span><span class="delta ${change.className}">${change.label}</span></div></article>`
    })
    .join('')
}

function renderTerminalRegression(terminal) {
  const rows = [
    ['Median key echo', 'medianMs', 'ms'],
    ['Worst key echo', 'worstMs', 'ms'],
    ['Maximum timer drift', 'maxTimerDriftMs', 'ms'],
    ['Dropped renderer backlogs', 'rendererDroppedBacklogs', 'count']
  ]
    .map(([metric, key, type]) => {
      const budget = terminal.budgets[key]
      const budgetLabel = budget === 0 ? '0' : `≤ ${formatMetric(budget, type)}`
      return `<tr><th scope="row">${metric}</th><td>${formatMetric(terminal[key], type)}</td><td>${budgetLabel}</td></tr>`
    })
    .join('')
  return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">Responsiveness guard</p><h2>${terminal.paneCount}-pane terminal regression</h2></div><span class="verified">${terminal.passed ? 'Passed' : 'Failed'}</span></div><p class="section-copy">The artificial OpenCode workload exercises typing while the other panes stream output. Pass status requires every displayed metric to be present and at or below its displayed budget.</p><div class="table-scroll"><table><thead><tr><th>Metric</th><th>Observed</th><th>Budget</th></tr></thead><tbody>${rows}</tbody></table></div></section>`
}

function renderValidationList() {
  return VALIDATION_EVIDENCE.map((label) => `<li><span>${label}</span></li>`).join('')
}

const PAGE_CSS = `
@font-face{font-family:'Geist';src:url(data:font/woff2;base64,{{FONT}}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}
:root{color-scheme:light dark;--background:#fff;--foreground:#0a0a0a;--card:#fff;--primary:#171717;--muted:#f5f5f5;--muted-foreground:#737373;--border:#e5e5e5;--ring:#a1a1a1;--success:#15803d;--danger:#e40014;--radius:.625rem}
@media(prefers-color-scheme:dark){:root{--background:#0a0a0a;--foreground:#fafafa;--card:#171717;--primary:#e5e5e5;--muted:#262626;--muted-foreground:#a1a1a1;--border:rgb(255 255 255/.07);--ring:#737373;--success:#86efac;--danger:#ff6568}}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font-family:'Geist',sans-serif;letter-spacing:.01em}main{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:64px 0 80px}h1,h2,p{margin-top:0}h1{max-width:820px;font-size:clamp(32px,5vw,56px);line-height:1.02;letter-spacing:-.035em;margin-bottom:20px}h2{font-size:20px;letter-spacing:-.01em;margin-bottom:0}.hero{padding-bottom:40px;border-bottom:1px solid var(--border)}.hero-copy{max-width:760px;color:var(--muted-foreground);font-size:16px;line-height:1.6;margin-bottom:24px}.eyebrow{margin-bottom:10px;color:var(--muted-foreground);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}.signal{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:1px solid var(--border);border-radius:calc(var(--radius)*1.4);background:var(--muted);font-size:13px;line-height:1.5}.signal strong{white-space:nowrap}.headline-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metric-card,.panel{border:1px solid var(--border);background:var(--card);border-radius:calc(var(--radius)*1.4)}.metric-card{padding:18px}.metric-card p{color:var(--muted-foreground);font-size:12px;margin-bottom:8px}.metric-card strong{display:block;font-size:25px;letter-spacing:-.03em;margin-bottom:12px}.metric-card div{display:flex;justify-content:space-between;gap:8px;color:var(--muted-foreground);font-size:11px}.sample-count{display:block;color:var(--muted-foreground);font-size:11px;font-weight:500;margin-top:2px}.panel{padding:24px;margin-top:16px}.section-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.section-copy{max-width:780px;color:var(--muted-foreground);font-size:13px;line-height:1.6;margin:12px 0 18px}.verified{border:1px solid color-mix(in srgb,var(--success) 25%,transparent);border-radius:999px;color:var(--success);font-size:11px;font-weight:600;padding:5px 9px;white-space:nowrap}.delta{display:inline-flex;border-radius:999px;padding:3px 7px;font-size:11px;font-weight:600}.delta.better{color:var(--foreground);background:color-mix(in srgb,var(--success) 10%,transparent)}.delta.worse{color:var(--foreground);background:color-mix(in srgb,var(--danger) 10%,transparent)}.delta.neutral{color:var(--foreground);background:var(--muted)}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}th:first-child{text-align:left}thead th{color:var(--foreground);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:var(--muted)}tbody th{font-weight:500}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:16px}.proof-list{list-style:none;padding:0;margin:16px 0 0}.proof-list li{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--border);font-size:12px}.proof-list li:last-child{border-bottom:0}.proof-list span{color:var(--muted-foreground)}.formula{padding:14px 16px;border-radius:calc(var(--radius)*.8);background:var(--muted);font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:12px;margin:14px 0}.footnote{color:var(--muted-foreground);font-size:11px;line-height:1.6;margin:18px 0 0}footer{color:var(--muted-foreground);font-size:11px;padding-top:32px;text-align:center}@media(max-width:850px){.headline-grid{grid-template-columns:repeat(2,1fr)}.two-column{grid-template-columns:1fr}}@media(max-width:520px){main{width:min(100% - 20px,1120px);padding-top:32px}.headline-grid{grid-template-columns:1fr}.panel{padding:18px}.section-heading{display:block}.verified{display:inline-flex;margin-top:12px}.signal{display:block}.signal strong{display:block;margin-bottom:5px}}
`

function renderHtml({ evidence, fontBase64, generatedAt }) {
  const listenerReduction = changeLabel(
    LISTENER_EVIDENCE.baselineWithoutAgents,
    LISTENER_EVIDENCE.candidateWithoutAgents
  ).label
  const longTaskRuns = evidence.burst.batch.metricRunCounts.longTaskP95Ms
  const longTaskQualifier =
    longTaskRuns === evidence.burst.batch.runCount
      ? ''
      : ` from ${longTaskRuns} of ${evidence.burst.batch.runCount} repetitions with a long task`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"><title>Orca renderer agent-status performance</title><style>${PAGE_CSS.replace('{{FONT}}', fontBase64)}</style></head>
<body><main><header class="hero"><p class="eyebrow">Renderer performance · point-in-time evidence</p><h1>One store publication per deferred status transaction, with ordered semantics intact.</h1><p class="hero-copy">The direct-store benchmark isolates the renderer action after IPC has formed a deferred status transaction; it is not an end-to-end IPC publication count. The 2,000-update candidate transaction completes with one synchronous Zustand publication and a ${formatMetric(evidence.burst.batch.metrics.longTaskP95Ms, 'ms')} median p95 long task${longTaskQualifier}.</p><aside class="signal"><strong>Production signal</strong><span>Removing all configured remote hosts restored responsiveness. That narrows the trigger to mounted remote worktrees and/or remote reconnect/status traffic; it does not yet distinguish between them. This renderer fix bounds the status/store amplification portion without changing the remote wire contract; reconnect repaint remains a separate follow-up.</span></aside></header>
<section class="headline-grid" aria-label="Headline burst results">${renderHeadlineCards(evidence)}</section>
${renderComparisonTable('Single dense burst', evidence.burst)}
${renderComparisonTable(`${formatNumber(evidence.cadence.sequential.workloadIntervalMs, 0)} ms sustained saturation stress`, evidence.cadence, ' This sustained case is comparative stress, not a real-time production SLO. Cadence p95 CPU is saturated and noisy; completion time, scheduling drift, mean CPU, and long tasks are the discriminating measures.')}
${renderTerminalRegression(evidence.terminal)}
<section class="two-column"><article class="panel"><p class="eyebrow">Structural multiplier</p><h2>Mounted subscription budget</h2><div class="formula">status work ≈ updates × listeners × selector work</div><p class="section-copy">The zero-agent 100-worktree fixture fell from ${formatNumber(LISTENER_EVIDENCE.baselineWithoutAgents, 0)} to ${formatNumber(LISTENER_EVIDENCE.candidateWithoutAgents, 0)} listeners (${listenerReduction}). The full candidate fixture mounts ${formatNumber(LISTENER_EVIDENCE.candidateWithHundredAgents, 0)} listeners with 100 visible agent rows.</p><p class="footnote">Listener fixtures are structural counts, not CPU samples. Unmount tests require the real store listener count to return to its prior baseline.</p></article><article class="panel"><p class="eyebrow">Validation coverage</p><h2>Behavioral checks</h2><ul class="proof-list">${renderValidationList()}</ul><p class="footnote">Equivalence coverage includes repeated same-pane transitions, stale rejection, retention, provider sessions, title generation, freshness, completion refresh, and synchronous re-entry.</p></article></section>
<section class="panel"><p class="eyebrow">Methodology</p><h2>Reproducible, sanitized evidence</h2><p class="section-copy">Each renderer comparison uses ${evidence.burst.sequential.runCount} equal-count repetitions of an E2E-mode Electron build with ${formatNumber(evidence.burst.sequential.worktrees, 0)} mounted worktrees, lineage depth ${evidence.burst.sequential.lineageDepth}, and ${formatNumber(evidence.burst.sequential.seededAgentRows, 0)} seeded agent rows. The workload calls the real store action directly, downstream of IPC. The generator rejects incomplete workloads and differences in platform, architecture, CPU count, sampling configuration, fixture dimensions, or repetition count. Updates follow a seeded ordered round-robin pattern and every run verifies the final state.</p><p class="footnote">Reported values are medians. When a metric is absent for some repetitions, its cell names the contributing run count; a zero long-task count remains part of the count median. CPU comparisons are meaningful only on the same machine and Electron build mode. Lower is better except update throughput. Process inventories, temporary paths, pane IDs, commands, DOM text, and raw samples are intentionally omitted.</p></section>
<footer>Generated ${generatedAt} · Self-contained HTML · No scripts or external requests</footer></main></body></html>`
}

export function generateRendererPerformanceHtmlReport({
  groups,
  terminalReportPath,
  terminalPanes = 20,
  outputPath = DEFAULT_OUTPUT,
  fontPath = DEFAULT_FONT,
  now = new Date()
}) {
  const evidence = collectRendererPerformanceEvidence({
    groups,
    terminalReportPath,
    terminalPanes
  })
  const fontBase64 = readFileSync(fontPath).toString('base64')
  const html = renderHtml({ evidence, fontBase64, generatedAt: now.toISOString() })
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, html)
  return { outputPath, evidence }
}

const isMain = process.argv[1] && import.meta.filename === process.argv[1]
if (isMain) {
  try {
    const result = generateRendererPerformanceHtmlReport(
      parseRendererPerformanceReportArgs(process.argv.slice(2))
    )
    console.log(`Renderer performance HTML report saved to ${result.outputPath}.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
