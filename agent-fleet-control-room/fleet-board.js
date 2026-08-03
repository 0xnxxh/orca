/* Fleet · Board — worktree cards in reading order, from window.FLEET. */
(function () {
  'use strict';
  const F = window.FLEET;
  const MAC = navigator.userAgent.includes('Mac');

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const STATE_LABEL = {
    attention: 'Needs an answer', permission: 'Awaiting permission', failed: 'Failed',
    working: 'Working', review: 'Ready to review', done: 'Done',
  };

  // ---- chrome ---------------------------------------------------------------
  const chips = document.getElementById('chips');
  [
    ['attention', F.counts.needsYou, 'need you'],
    ['working', F.counts.working, 'working'],
    ['review', F.counts.review, 'to review'],
    ['done', F.counts.done, 'done'],
  ].forEach(([state, n, label]) => {
    const c = el('span');
    const dot = el('i', 'dot');
    dot.dataset.state = state === 'attention' ? 'attention' : state;
    if (state !== 'attention') dot.style.animation = 'none';
    dot.style.width = '6px';
    dot.style.height = '6px';
    c.append(dot, el('b', null, String(n)), el('span', null, label));
    chips.append(c);
  });
  document.getElementById('accounting').textContent =
    F.counts.total + ' / ' + F.counts.fleetTotal + ' agents · ' +
    F.byWorktree.length + ' / ' + F.counts.fleetWorktrees + ' worktrees';
  document.getElementById('search').placeholder = 'Filter…  ' + (MAC ? '⌘' : 'Ctrl+') + 'K';

  // ---- board ----------------------------------------------------------------
  const board = document.getElementById('board');
  const agentRows = new Map();
  let selected = null;

  function tailBlock(a, lines) {
    const pre = el('pre', 'tail');
    lines.forEach((ln, i) => pre.append(el('span', i === lines.length - 1 ? 'now' : null, ln + '\n')));
    return pre;
  }

  F.projects.forEach((p) => {
    const head = el('div', 'section-head');
    head.append(
      el('h2', null, p.name),
      el('span', 'meta', p.worktrees.length + ' worktrees · ' + p.agents.length + ' agents'),
      el('span', 'rule'),
    );
    board.append(head);

    const grid = el('div', 'grid');
    // Reading order: worktrees that need you first, then alphabetical — stable.
    const wts = p.worktrees.slice().sort((a, b) => {
      const ra = F.severityRank(a.worstState);
      const rb = F.severityRank(b.worstState);
      const na = ra <= 2 ? 0 : 1;
      const nb = rb <= 2 ? 0 : 1;
      return na - nb || a.worktree.localeCompare(b.worktree);
    });

    wts.forEach((g) => {
      const card = el('article', 'wt');
      card.dataset.worst = g.worstState;
      card.dataset.search = (g.worktree + ' ' + g.agents.map((a) => a.name).join(' ')).toLowerCase();

      const head = el('div', 'wt-head');
      head.append(el('span', 'wt-name', g.worktree));
      if (g.unread) head.append(el('i', 'unread-dot'));
      head.append(el('span', 'wt-count', String(g.agents.length)));
      card.append(head);

      // Compact density: agents collapse to a dot cluster in the header line.
      const dots = el('div', 'dots-row');
      g.agents.forEach((a) => {
        const d = el('i', 'dot');
        d.dataset.state = a.state;
        dots.append(d);
      });
      card.append(dots);

      g.agents.forEach((a) => {
        const row = el('div', 'agent');
        if (a.bucket === 'needsYou') row.classList.add('is-loud');
        const dot = el('i', 'dot');
        dot.dataset.state = a.state;
        row.append(dot, el('span', 'agent-name', a.shortName));
        if (a.pr) row.append(el('span', 'agent-pr', '#' + a.pr.number));
        row.append(el('span', 'agent-age', F.ageLabel(a.state === 'done' || a.state === 'review' ? a.durationMs : a.startedAgo)));
        row.addEventListener('click', () => select(a, row));
        card.append(row);
        agentRows.set(a.id, row);

        // The line that needs you, always visible at normal density.
        if (a.state === 'attention') card.append(el('p', 'agent-ask', a.question.text));
        else if (a.state === 'permission') card.append(el('p', 'agent-ask', 'Waiting for permission: ' + '$ ' + (F.decisions.find((d) => d.key === a.decisionKey) || {}).command));
        else if (a.state === 'failed') card.append(el('p', 'agent-ask', a.failure));

        card.append(tailBlock(a, F.fakeTail(a).slice(-4)));
      });

      grid.append(card);
    });
    board.append(grid);
  });

  // ---- density --------------------------------------------------------------
  const densityBar = document.getElementById('density');
  function setDensity(d) {
    board.dataset.density = d;
    densityBar.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.d === d));
  }
  densityBar.addEventListener('click', (e) => {
    if (e.target.dataset.d) setDensity(e.target.dataset.d);
  });
  const ORDER = ['compact', 'normal', 'detail'];
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const i = ORDER.indexOf(board.dataset.density) + (e.deltaY < 0 ? 1 : -1);
    if (ORDER[i]) setDensity(ORDER[i]);
  }, { passive: false });

  // ---- respond panel --------------------------------------------------------
  const panel = document.getElementById('panel');
  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove('panel-open');
    if (selected) agentRows.get(selected.id)?.classList.remove('is-selected');
    selected = null;
  }
  function select(a, row) {
    if (selected) agentRows.get(selected.id)?.classList.remove('is-selected');
    selected = a;
    row.classList.add('is-selected');
    panel.hidden = false;
    document.body.classList.add('panel-open');
    panel.replaceChildren();

    const close = el('button', 'close', '✕');
    close.addEventListener('click', closePanel);
    panel.append(close, el('h1', null, a.shortName));

    const sl = el('div', 'state-line');
    const d = el('i', 'dot');
    d.dataset.state = a.state;
    sl.append(d, el('span', null, STATE_LABEL[a.state] + ' · ' + (a.alive ? 'process live' : 'reply restarts it')));
    panel.append(sl, el('p', 'path', a.displayProject + ' / ' + a.worktree));
    panel.append(tailBlock(a, F.fakeTail(a).slice(-8)));

    if (a.state === 'attention') {
      panel.append(el('p', 'question', a.question.text));
      const opts = el('div', 'opts');
      a.question.options.forEach((opt, i) => {
        const b = el('button');
        b.append(el('kbd', null, String(i + 1)), document.createTextNode(opt));
        opts.append(b);
      });
      panel.append(opts);
    } else if (a.state === 'permission') {
      const dec = F.decisions.find((x) => x.key === a.decisionKey);
      panel.append(el('p', 'question', 'Allow ' + dec.command + '? ' + dec.agents.length + ' agents are waiting on this decision.'));
      const actions = el('div', 'actions');
      const allow = el('button', 'primary', 'Allow — resumes ' + dec.agents.length);
      actions.append(allow, el('button', null, 'Deny'));
      panel.append(actions);
    } else if (a.state === 'failed') {
      panel.append(el('p', 'question', a.failure));
      const actions = el('div', 'actions');
      actions.append(el('button', 'primary', 'Retry'), el('button', null, 'Open terminal'));
      panel.append(actions);
    } else if (a.state === 'review') {
      const actions = el('div', 'actions');
      actions.append(el('button', 'primary', 'Review diff'), el('button', null, 'Mark reviewed'));
      panel.append(actions);
    }
    const reply = el('div', 'reply');
    const input = Object.assign(el('input'), {
      placeholder: a.state === 'working' ? 'Queue a message…' : 'Reply…',
    });
    reply.append(input);
    panel.append(reply);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  // ---- search ---------------------------------------------------------------
  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('.wt').forEach((card) => {
      card.classList.toggle('is-dim', !!q && !card.dataset.search.includes(q));
    });
  });
  document.addEventListener('keydown', (e) => {
    if ((MAC ? e.metaKey : e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      search.focus();
    }
  });

  // ---- footer ---------------------------------------------------------------
  const whisper = document.getElementById('whisper');
  [
    ['var(--state-attention)', 'needs you'],
    ['color-mix(in srgb, var(--state-working) 75%, transparent)', 'working'],
    ['color-mix(in srgb, var(--state-done) 85%, transparent)', 'review'],
    ['var(--state-idle)', 'done'],
  ].forEach(([color, label]) => {
    const s = el('span');
    const i = el('i');
    i.style.background = color;
    s.append(i, el('span', null, label));
    whisper.append(s);
  });
  whisper.append(el('span', null, (MAC ? '⌃' : 'Ctrl+') + 'scroll = density · captured ' +
    new Date(F.now).toISOString().slice(11, 16) + ' UTC'));

  // ---- pre-seed: select the first attention agent in reading order ----------
  const seed = F.projects.flatMap((p) => p.agents).find((a) => a.state === 'attention');
  if (seed) select(seed, agentRows.get(seed.id));

  const wanted = new URLSearchParams(location.search).get('d');
  if (ORDER.includes(wanted)) setDensity(wanted);
})();
