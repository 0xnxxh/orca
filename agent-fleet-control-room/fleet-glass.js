/* Fleet · Glass — worktree glass cards with agents as orbs, from window.FLEET. */
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
  document.getElementById('accounting').textContent =
    F.counts.total + ' / ' + F.counts.fleetTotal + ' agents · ' +
    F.byWorktree.length + ' / ' + F.counts.fleetWorktrees + ' worktrees';
  document.getElementById('search').placeholder = 'Filter…  ' + (MAC ? '⌘' : 'Ctrl+') + 'K';

  const stats = document.getElementById('stats');
  [
    ['is-attention', F.counts.needsYou, 'need you'],
    ['is-working', F.counts.working, 'working'],
    ['is-review', F.counts.review, 'to review'],
    ['is-done', F.counts.done, 'done'],
  ].forEach(([cls, n, label]) => {
    const s = el('div', 'stat ' + cls);
    s.append(el('span', 'n', String(n)), el('span', 'l', label));
    stats.append(s);
  });

  // ---- field ----------------------------------------------------------------
  const field = document.getElementById('field');
  const orbEls = new Map();
  let selected = null;

  function tailBlock(a, count) {
    const pre = el('pre', 'tail');
    const lines = F.fakeTail(a).slice(-count);
    lines.forEach((ln, i) => pre.append(el('span', i === lines.length - 1 ? 'now' : null, ln + '\n')));
    return pre;
  }

  F.projects.forEach((p) => {
    const head = el('div', 'section-head');
    head.append(
      el('h2', null, p.name),
      el('span', 'meta', p.worktrees.length + ' worktrees · ' + p.agents.length + ' agents'),
    );
    field.append(head);

    const grid = el('div', 'grid');
    const wts = p.worktrees.slice().sort((a, b) => {
      const na = F.severityRank(a.worstState) <= 2 ? 0 : 1;
      const nb = F.severityRank(b.worstState) <= 2 ? 0 : 1;
      return na - nb || a.worktree.localeCompare(b.worktree);
    });

    wts.forEach((g) => {
      const card = el('article', 'wt');
      card.dataset.worst = g.worstState;
      card.dataset.search = (g.worktree + ' ' + g.agents.map((a) => a.name).join(' ')).toLowerCase();

      const head = el('div', 'wt-head');
      head.append(el('span', 'wt-name', g.worktree), el('span', 'wt-count', String(g.agents.length)));
      card.append(head);

      const orbs = el('div', 'orbs');
      const loud = [];
      g.agents.forEach((a) => {
        const o = el('i', 'orb');
        o.dataset.state = a.state;
        o.addEventListener('click', () => select(a, o));
        o.addEventListener('mousemove', (e) => showTip(e, a));
        o.addEventListener('mouseleave', hideTip);
        orbs.append(o);
        orbEls.set(a.id, o);
        if (a.bucket === 'needsYou') loud.push(a);
      });
      card.append(orbs);

      // Words only where something needs you.
      loud.forEach((a) => {
        const ask = el('div', 'ask');
        const o = el('i', 'orb');
        o.dataset.state = a.state;
        o.style.animation = 'none';
        const text =
          a.state === 'attention' ? a.question.text :
          a.state === 'permission' ? 'Allow ' + (F.decisions.find((d) => d.key === a.decisionKey) || {}).command + '?' :
          a.failure;
        ask.append(o, el('span', null, text));
        ask.addEventListener('click', () => select(a, orbEls.get(a.id)));
        ask.style.cursor = 'pointer';
        card.append(ask);
      });

      grid.append(card);
    });
    field.append(grid);
  });

  // ---- tooltip --------------------------------------------------------------
  const tip = document.getElementById('tooltip');
  function showTip(e, a) {
    tip.hidden = false;
    tip.replaceChildren(
      el('div', 't-name', a.shortName),
      el('div', 't-meta', STATE_LABEL[a.state] + ' · ' + a.agentType + ' · ' +
        F.ageLabel(a.state === 'done' || a.state === 'review' ? a.durationMs : a.startedAgo) +
        (a.detail && a.state === 'working' ? ' · ' + a.detail : '')),
    );
    const pad = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = e.clientX + pad;
    let y = e.clientY - h - 10;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y < 60) y = e.clientY + pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() {
    tip.hidden = true;
  }

  // ---- panel ----------------------------------------------------------------
  const panel = document.getElementById('panel');
  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove('panel-open');
    if (selected) orbEls.get(selected.id)?.classList.remove('is-selected');
    selected = null;
  }
  function select(a, orb) {
    if (selected) orbEls.get(selected.id)?.classList.remove('is-selected');
    selected = a;
    orb?.classList.add('is-selected');
    panel.hidden = false;
    document.body.classList.add('panel-open');
    panel.replaceChildren();

    const close = el('button', 'close', '✕');
    close.addEventListener('click', closePanel);
    panel.append(close, el('h1', null, a.shortName));

    const sl = el('div', 'state-line');
    const d = el('i', 'orb');
    d.dataset.state = a.state;
    d.style.animation = 'none';
    sl.append(d, el('span', null, STATE_LABEL[a.state] + ' · ' + (a.alive ? 'process live' : 'reply restarts it')));
    panel.append(sl, el('p', 'path', a.displayProject + ' / ' + a.worktree));
    panel.append(tailBlock(a, 8));

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
      panel.append(el('p', 'question', 'Allow ' + dec.command + '? ' + dec.agents.length + ' agents are waiting on this one decision.'));
      const actions = el('div', 'actions');
      actions.append(el('button', 'primary', 'Allow — resumes ' + dec.agents.length), el('button', null, 'Deny'));
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
    reply.append(Object.assign(el('input'), {
      placeholder: a.state === 'working' ? 'Queue a message…' : 'Reply…',
    }));
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

  // ---- whisper --------------------------------------------------------------
  const whisper = document.getElementById('whisper');
  [
    ['var(--state-attention)', 'needs you'],
    ['color-mix(in srgb, var(--state-working) 62%, transparent)', 'working'],
    ['color-mix(in srgb, var(--state-done) 72%, transparent)', 'review'],
    ['rgb(255 255 255 / 0.14)', 'done'],
  ].forEach(([color, label]) => {
    const s = el('span');
    const i = el('i');
    i.style.background = color;
    s.append(i, el('span', null, label));
    whisper.append(s);
  });
  whisper.append(el('span', null, 'captured ' + new Date(F.now).toISOString().slice(11, 16) + ' UTC'));

  // ---- pre-seed -------------------------------------------------------------
  const seed = F.projects.flatMap((p) => p.agents).find((a) => a.state === 'attention');
  if (seed) select(seed, orbEls.get(seed.id));
})();
