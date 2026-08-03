/* Enriches the real captured fleet snapshot (window.AGENT_ACTIVITY_SNAPSHOT, 104 agents)
   with the states the capture lacks: the CLI only reports working|done, so attention /
   permission / failed / review, process liveness, PRs and pins are synthesized
   DETERMINISTICALLY (FNV-1a over agent id) so every reload and screenshot is identical.
   Exposes window.FLEET. */
(function () {
  'use strict';
  const snapshot = window.AGENT_ACTIVITY_SNAPSHOT;
  if (!snapshot) throw new Error('actual-agent-activity.js must be loaded first');
  const NOW = snapshot.capturedAt;

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  const QUESTIONS = [
    {
      text: 'pnpm test fails on main too — proceed with the fix anyway, or investigate the baseline failure first?',
      options: ['Proceed, note baseline failure in the PR', 'Investigate the baseline first', 'Skip the failing suite'],
    },
    {
      text: 'This touches both the renderer IPC contract and the pop-out payload. Keep one PR or split?',
      options: ['Keep one PR', 'Split: IPC contract first', 'Show me the diff before deciding'],
    },
    {
      text: 'The worktree has uncommitted changes from a previous run. Stash them or start clean?',
      options: ['Stash and continue', 'Discard and start clean', 'Show me the diff'],
    },
  ];

  const DECISIONS = [
    {
      key: 'bash:pnpm-test',
      title: 'Allow `pnpm test`',
      command: 'pnpm test --filter dashboard',
      detail: 'Run the workspace test suite',
    },
    {
      key: 'bash:gh-pr-create',
      title: 'Allow `gh pr create`',
      command: 'gh pr create --fill',
      detail: 'Open a pull request with the branch changes',
    },
  ];

  const FAILURES = [
    'Error: vitest worker terminated (OOM) — 3 retries exhausted',
    'fatal: could not read from remote repository — auth prompt in non-interactive shell',
  ];

  // ---- state assignment ------------------------------------------------------
  const working = snapshot.agents.filter((a) => a.status === 'working');
  const done = snapshot.agents.filter((a) => a.status !== 'working');
  working.sort((a, b) => hash(a.id) - hash(b.id));
  done.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  const stateById = new Map();
  working.forEach((a, i) => {
    if (i < 3) stateById.set(a.id, 'attention');
    else if (i < 9) stateById.set(a.id, 'permission');
    else if (i < 11) stateById.set(a.id, 'failed');
    else stateById.set(a.id, 'working');
  });
  done.forEach((a, i) => stateById.set(a.id, i < 14 ? 'review' : 'done'));

  const BUCKET = {
    attention: 'needsYou', permission: 'needsYou', failed: 'needsYou',
    working: 'working', review: 'review', done: 'done',
  };
  const STATE_COLOR = {
    attention: '--state-attention', permission: '--state-attention', failed: '--state-blocked',
    working: '--state-working', review: '--state-done', done: '--state-idle',
  };
  // Shape carries state independently of hue (yellow≈amber is CVD-unsafe by itself).
  const STATE_GLYPH = { attention: '?', permission: '⇧', failed: '✕', working: '✻', review: '✔', done: '∙' };

  let qi = 0;
  let di = 0;
  let prNumber = 11731;
  const agents = snapshot.agents.map((raw) => {
    const state = stateById.get(raw.id);
    const h = hash(raw.id);
    const a = Object.assign({}, raw);
    a.state = state;
    a.bucket = BUCKET[state];
    a.displayProject =
      /mobile/.test(raw.worktree) ? 'orca-mobile'
      : /^auto-daily/.test(raw.branchFrom || '') ? 'automation'
      : 'orca';
    a.shortName = raw.name.length > 64 ? raw.name.slice(0, 63).trimEnd() + '…' : raw.name;
    a.question = state === 'attention' ? QUESTIONS[qi++ % QUESTIONS.length] : null;
    a.decisionKey = state === 'permission' ? DECISIONS[di++ < 4 ? 0 : 1].key : null;
    a.failure = state === 'failed' ? FAILURES[h % FAILURES.length] : null;
    // Liveness is a separate channel from state: alive replies now, exited restarts on reply.
    a.alive = a.bucket === 'needsYou' || state === 'working' ? h % 11 !== 0 : state === 'review' && h % 4 === 0;
    a.loopSleeping = state === 'working' && h % 17 === 0;
    a.pr = (state === 'review' || state === 'done') && h % 5 === 0 ? { number: prNumber++, state: 'open' } : null;
    a.pinned = false;
    a.startedAgo = NOW - raw.startedAt;
    a.durationMs = (raw.completedAt || NOW) - raw.startedAt;
    return a;
  });
  // Two deterministic pins: the longest-running attention agent, the newest review agent.
  const att = agents.filter((a) => a.state === 'attention').sort((a, b) => b.startedAgo - a.startedAgo);
  if (att[0]) att[0].pinned = true;
  const rev = agents.filter((a) => a.state === 'review');
  if (rev[0]) rev[0].pinned = true;

  // ---- grouping (stable: alpha by name, agents by start time — never a live metric) ----
  const SEVERITY = ['failed', 'attention', 'permission', 'working', 'review', 'done'];
  const worst = (list) => SEVERITY[Math.min(...list.map((a) => SEVERITY.indexOf(a.state)))];

  const byWorktree = [];
  const wtIndex = new Map();
  for (const a of agents) {
    const key = a.displayProject + '/' + a.worktree;
    if (!wtIndex.has(key)) {
      wtIndex.set(key, { project: a.displayProject, worktree: a.worktree, unread: false, agents: [] });
      byWorktree.push(wtIndex.get(key));
    }
    const g = wtIndex.get(key);
    g.agents.push(a);
    g.unread = g.unread || a.unread;
  }
  byWorktree.sort((x, y) => x.worktree.localeCompare(y.worktree));
  byWorktree.forEach((g) => {
    g.agents.sort((x, y) => x.startedAt - y.startedAt);
    g.worstState = worst(g.agents);
  });

  const projects = [];
  const pIndex = new Map();
  for (const g of byWorktree) {
    if (!pIndex.has(g.project)) {
      pIndex.set(g.project, { name: g.project, worktrees: [], agents: [] });
      projects.push(pIndex.get(g.project));
    }
    pIndex.get(g.project).worktrees.push(g);
    pIndex.get(g.project).agents.push(...g.agents);
  }
  projects.sort((x, y) => x.name.localeCompare(y.name));
  projects.forEach((p) => { p.worstState = worst(p.agents); });

  const decisions = DECISIONS.map((d) => Object.assign({}, d, {
    agents: agents.filter((a) => a.decisionKey === d.key),
  })).filter((d) => d.agents.length > 0);

  const buckets = { needsYou: [], working: [], review: [], done: [] };
  agents.forEach((a) => buckets[a.bucket].push(a));
  const counts = {
    needsYou: buckets.needsYou.length,
    working: buckets.working.length,
    review: buckets.review.length,
    done: buckets.done.length,
    total: agents.length,
    fleetTotal: snapshot.sourceSummary.agents,
    fleetWorktrees: snapshot.sourceSummary.worktrees,
  };

  // ---- helpers ---------------------------------------------------------------
  function ageLabel(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const hrs = Math.floor(m / 60);
    if (hrs < 24) return hrs + 'h ' + (m % 60) + 'm';
    return Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h';
  }

  const TAIL_WORKING = [
    ['$ pnpm vitest run src/renderer/src/components/dashboard-popout', '', ' RUN  AgentKanbanBoard.test.tsx', ' ✓ groups cards by bucket (18ms)', ' ✓ keeps column order stable across refresh (9ms)'],
    ['$ git diff --stat', ' src/main/ipc/dashboard-payload-validation.ts | 41 ++++--', ' 3 files changed, 96 insertions(+), 22 deletions(-)', '$ pnpm oxlint src/main/ipc'],
    ['Reading src/shared/dashboard-snapshot.ts…', 'Editing build-dashboard-snapshot.ts', '  + carried stateChangedAt through the retained-row path'],
  ];
  const TAIL_DONE = [
    ['✔ All 42 tests passed', '✔ Finished — 3 files changed, +214 −87', 'Ready for review.'],
    ['$ gh pr view --json state', '{ "state": "OPEN" }', '✔ Finished — PR updated, CI running.'],
  ];
  function fakeTail(a) {
    const h = hash(a.id + ':tail');
    let lines;
    if (a.state === 'failed') lines = ['$ ' + (DECISIONS[0].command), '', a.failure, 'Process exited with code 1'];
    else if (a.state === 'attention') lines = TAIL_WORKING[h % TAIL_WORKING.length].concat(['', '? ' + a.question.text]);
    else if (a.state === 'permission') lines = ['About to run:', '  $ ' + DECISIONS.find((d) => d.key === a.decisionKey).command, '', 'Waiting for permission…'];
    else if (a.bucket === 'working') lines = TAIL_WORKING[h % TAIL_WORKING.length].concat([a.detail ? '· ' + a.detail : '']);
    else lines = TAIL_DONE[h % TAIL_DONE.length];
    return lines;
  }

  window.FLEET = {
    now: NOW, agents, byWorktree, projects, decisions, buckets, counts,
    ageLabel, fakeTail, hash,
    stateColorVar: (s) => STATE_COLOR[s],
    stateGlyph: (s) => STATE_GLYPH[s],
    severityRank: (s) => SEVERITY.indexOf(s),
  };
})();
