/* Fleet · Strips — every row is a flight strip that stays in its bay until it is
   acted on. Ages come from FLEET.now (never Date.now) so reloads are identical. */
(function () {
  'use strict';

  const F = window.FLEET;
  if (!F) throw new Error('fleet-state-synthesis.js must be loaded first');

  const IS_MAC = navigator.userAgent.includes('Mac');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const SCOPES = ['This once', 'This project', 'Always'];

  // ---- deterministic pre-expanded rows (the states this mock is meant to show) ----
  const attention = F.agents.filter((a) => a.state === 'attention');
  const failed = F.agents.filter((a) => a.state === 'failed');
  const reviewByFinish = F.buckets.review.slice().sort((x, y) => y.completedAt - x.completedAt);
  const doneByFinish = F.buckets.done.slice().sort((x, y) => y.completedAt - x.completedAt);

  const peekAgent = attention.find((a) => a.pinned) || attention[0];
  // Hover preview on the top (pinned) review strip — the only one above the rack fold.
  const hoverAgent =
    reviewByFinish.slice().sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0))[0];

  const ui = {
    pins: new Set(F.agents.filter((a) => a.pinned).map((a) => a.id)),
    peekId: peekAgent.id,
    focusId: peekAgent.id,
    hoverId: hoverAgent.id,
    answered: new Map(),
    acked: new Set(),
    reviewed: new Set(),
    resolved: new Map(),
    scopes: new Map(F.decisions.map((d) => [d.key, 0])),
    openDecision: F.decisions[0].key,
    doneUnfolded: false,
  };

  // ---- tiny DOM helpers (textContent only — agent names carry quotes and backticks) ----
  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function kbd(text) {
    return h('kbd', null, text);
  }
  function btn(cls, label, onClick) {
    const b = h('button', 'btn ' + cls, label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
    return b;
  }
  function pinFirst(list) {
    return list.slice().sort((x, y) => (ui.pins.has(y.id) ? 1 : 0) - (ui.pins.has(x.id) ? 1 : 0));
  }

  // ---- counts (live: they drain as work is answered, never by silent removal) ----
  const resolvedAgentCount = () =>
    F.decisions.reduce((n, d) => n + (ui.resolved.has(d.key) ? d.agents.length : 0), 0);
  const openCount = () => F.counts.needsYou - ui.answered.size - resolvedAgentCount();
  // ISA-18.2: acknowledging silences the annunciation, it does not close the item.
  const unackedCount = () => openCount() - ui.acked.size;
  const unreviewedCount = () => F.counts.review - ui.reviewed.size;

  // ---- glyph: shape carries state, fill carries process liveness ----
  function glyph(a, stateOverride) {
    const state = stateOverride || a.state;
    const g = h('span', 'glyph state-' + state + (a.alive ? '' : ' is-exited'));
    if (state === 'working') {
      g.appendChild(h('span', a.loopSleeping ? 'crescent' : 'ring'));
      g.title = a.loopSleeping
        ? 'loop sleeping — wakes on schedule'
        : a.alive
          ? 'working'
          : 'process exited — a reply restarts it';
    } else {
      g.classList.add('g-char');
      g.textContent = F.stateGlyph(state);
      g.title = state + (a.alive ? ' · running' : ' · process exited, a reply restarts it');
    }
    return g;
  }

  function sleepNote(a) {
    return 'sleeping · next run in ' + ((F.hash(a.id) % 17) + 4) + 'm';
  }

  // ---- strip ----------------------------------------------------------------
  function strip(a, cfg) {
    const state = cfg.state || a.state;
    const group = h('div', 'strip-group state-' + state);
    group.dataset.id = a.id;
    if (ui.pins.has(a.id)) group.classList.add('is-pinned');
    if (cfg.blink) group.classList.add('is-blinking');
    if (cfg.pulse) group.classList.add('is-pulsing');
    if (ui.focusId === a.id) group.classList.add('is-focused');
    if (cfg.hovered) group.classList.add('is-hovered');

    const row = h('div', 'strip');
    row.appendChild(glyph(a, state));
    row.appendChild(h('span', 'chip-type', a.agentType));
    row.appendChild(h('span', 'cell-name', a.shortName));
    row.appendChild(h('span', 'cell-summary', cfg.summary));
    if (cfg.note) row.appendChild(h('span', 'chip-note', cfg.note));
    if (cfg.tag) row.appendChild(h('span', 'chip-tag', cfg.tag));

    if (cfg.actions) {
      const actions = h('div', 'cell-actions');
      if (cfg.hovered) actions.appendChild(h('span', 'chip-tag', 'hover'));
      cfg.actions.forEach((act) => actions.appendChild(btn('', act.label, act.run)));
      row.appendChild(actions);
    }

    row.appendChild(h('span', 'chip-worktree', a.worktree));
    if (a.pr) row.appendChild(h('span', 'chip-pr', '#' + a.pr.number));
    row.appendChild(h('span', 'cell-age', cfg.age));

    const pin = h('button', 'pin' + (ui.pins.has(a.id) ? ' is-on' : ''), ui.pins.has(a.id) ? '●' : '○');
    pin.type = 'button';
    pin.title = ui.pins.has(a.id) ? 'Unpin' : 'Pin to the top of this bay';
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(a.id);
    });
    row.appendChild(pin);

    row.addEventListener('click', () => {
      ui.focusId = a.id;
      if (a.question && !ui.answered.has(a.id)) ui.peekId = ui.peekId === a.id ? null : a.id;
      else if (a.failure) ui.acked.add(a.id);
      render();
    });
    if (a.failure && !ui.acked.has(a.id)) {
      row.title = 'Click to acknowledge — the strip stays until the failure is resolved';
    }
    group.appendChild(row);

    if (ui.peekId === a.id && a.question && !ui.answered.has(a.id)) group.appendChild(peek(a));
    return group;
  }

  // Peek expands in place and pushes the rack down — the strip never leaves its slot.
  function peek(a) {
    const box = h('div', 'peek');
    box.appendChild(h('p', 'peek-question', a.question.text));

    const actions = h('div', 'peek-actions');
    a.question.options.forEach((label, i) => {
      const b = btn('peek-option', null, () => answer(a.id, label));
      b.appendChild(kbd(String(i + 1)));
      b.appendChild(h('span', null, label));
      actions.appendChild(b);
    });
    actions.appendChild(h('span', 'peek-divider'));
    const input = h('input', 'peek-input');
    input.placeholder = 'Reply to ' + a.shortName.slice(0, 28) + '…';
    actions.appendChild(input);
    actions.appendChild(btn('btn-primary', 'Send', () => answer(a.id, 'custom reply')));
    box.appendChild(actions);

    const hint = h('div', 'peek-hint');
    [
      [kbd('Space'), 'peek'],
      [kbd('⏎'), 'attach'],
      [kbd('esc'), 'close'],
    ].forEach(([k, label], i) => {
      if (i) hint.appendChild(h('span', 'legend-dot', '·'));
      hint.appendChild(k);
      hint.appendChild(h('span', null, label));
    });
    box.appendChild(hint);
    box.addEventListener('click', (e) => e.stopPropagation());
    return box;
  }

  // ---- coalesced decision card: one answer unblocks several agents ----------
  function decisionCard(d) {
    const card = h('div', 'decision-card');
    const resolution = ui.resolved.get(d.key);

    if (resolution) {
      const row = h('div', 'dc-resolved');
      const g = h('span', 'glyph g-char', '✔');
      row.appendChild(g);
      row.appendChild(h('span', null, resolution.verb + ' ' + d.command + ' · ' + resolution.scope));
      row.appendChild(h('span', 'dc-meta', d.agents.length + ' agents resumed'));
      row.appendChild(
        btn('', 'Undo', () => {
          ui.resolved.delete(d.key);
          render();
        }),
      );
      card.appendChild(row);
      return card;
    }

    const open = ui.openDecision === d.key;
    card.classList.add('is-live');
    if (!open) card.classList.add('is-collapsed');

    const head = h('div', 'dc-head');
    head.appendChild(glyph(d.agents[0]));

    const title = h('span', 'dc-title');
    d.title.split('`').forEach((part, i) => {
      if (!part) return;
      title.appendChild(i % 2 ? h('code', null, part) : h('span', null, part));
    });
    head.appendChild(title);
    head.appendChild(h('span', 'dc-cmd', d.command));
    if (open) head.appendChild(h('span', 'dc-detail', d.detail));

    const projects = [...new Set(d.agents.map((a) => a.displayProject))];
    head.appendChild(h('span', 'dc-meta', d.agents.length + ' agents · ' + projects.join(' · ')));
    card.appendChild(head);

    const controls = h('div', open ? 'dc-controls' : 'dc-controls dc-inline');
    controls.appendChild(h('span', 'eyebrow', 'Scope'));
    const seg = h('div', 'segmented');
    SCOPES.forEach((label, i) => {
      const s = h('button', 'seg' + (ui.scopes.get(d.key) === i ? ' is-active' : ''), label);
      s.type = 'button';
      s.addEventListener('click', () => {
        ui.scopes.set(d.key, i);
        render();
      });
      seg.appendChild(s);
    });
    controls.appendChild(seg);
    controls.appendChild(h('span', 'spacer'));

    const toggle = h('button', 'dc-expand', d.agents.length + (open ? ' agents ▾' : ' agents ▸'));
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      ui.openDecision = open ? null : d.key;
      render();
    });
    controls.appendChild(toggle);
    controls.appendChild(btn('', 'Deny', () => resolve(d, 'Denied')));
    controls.appendChild(btn('btn-primary', 'Allow', () => resolve(d, 'Allowed')));

    if (open) {
      card.appendChild(controls);
      const list = h('div', 'dc-agents');
      d.agents.forEach((a) => {
        const r = h('div', 'dc-agent state-' + a.state);
        r.style.setProperty('--strip-state', 'var(' + F.stateColorVar(a.state) + ')');
        r.appendChild(glyph(a));
        r.appendChild(h('span', 'dc-agent-name', a.shortName));
        r.appendChild(h('span', 'chip-worktree', a.worktree));
        r.appendChild(h('span', 'spacer'));
        r.appendChild(h('span', 'cell-age', F.ageLabel(a.startedAgo)));
        list.appendChild(r);
      });
      card.appendChild(list);
    } else {
      head.appendChild(controls);
      controls.classList.add('dc-inline');
    }
    return card;
  }

  function resolve(d, verb) {
    ui.resolved.set(d.key, { verb: verb, scope: SCOPES[ui.scopes.get(d.key)].toLowerCase() });
    render();
  }

  // ---- bays -----------------------------------------------------------------
  function bay(key, name, count, affordance, note) {
    const el = h('section', 'bay bay-' + key);
    const head = h('div', 'bay-head');
    head.appendChild(h('span', 'eyebrow bay-name', name));
    head.appendChild(h('span', 'count-badge', String(count)));
    if (affordance) head.appendChild(affordance);
    if (note) head.appendChild(h('span', 'bay-note', note));
    el.appendChild(head);
    const body = h('div', 'bay-body');
    body.dataset.bay = key;
    el.appendChild(body);
    el.body = body;
    return el;
  }

  function affordance(cls, parts) {
    const wrap = h('span', 'bay-affordance' + (cls ? ' ' + cls : ''));
    parts.forEach((p) => wrap.appendChild(typeof p === 'string' ? h('span', null, p) : p));
    return wrap;
  }

  function needsYouBay() {
    const el = bay(
      'needsYou',
      'Needs you',
      openCount(),
      affordance(null, [kbd('F'), 'next needs-you', h('span', 'legend-dot', '·'), 'answer once, unblock many']),
      ui.acked.size ? ui.acked.size + ' acknowledged · still open until resolved' : null,
    );
    F.decisions.forEach((d) => el.body.appendChild(decisionCard(d)));

    // Severity order: failures outrank questions (FLEET.severityRank).
    failed.forEach((a) => {
      const acked = ui.acked.has(a.id);
      el.body.appendChild(
        strip(a, {
          summary: a.failure,
          age: F.ageLabel(a.startedAgo),
          blink: !acked,
          tag: acked ? 'acked' : null,
        }),
      );
    });

    pinFirst(attention).forEach((a) => {
      const answered = ui.answered.get(a.id);
      el.body.appendChild(
        strip(a, {
          // Answered strips do not vanish — they change state in place and go quiet.
          state: answered ? 'working' : 'attention',
          summary: answered ? 'Answered: ' + answered + ' · resuming' : a.question.text,
          age: F.ageLabel(a.startedAgo),
          blink: !answered,
          tag: answered ? 'answered' : null,
        }),
      );
    });
    return el;
  }

  function workingBay() {
    const exited = F.buckets.working.filter((a) => !a.alive).length;
    const sleeping = F.buckets.working.filter((a) => a.loopSleeping).length;
    const el = bay(
      'working',
      'Working',
      F.counts.working,
      affordance(null, [
        F.counts.working - exited - sleeping + ' running',
        h('span', 'legend-dot', '·'),
        exited + ' exited',
        h('span', 'legend-dot', '·'),
        sleeping + ' sleeping',
      ]),
      'no motion here — working is the quiet state',
    );
    // Longest-running first; the sleeping loop rides on top because it is not
    // holding a slot, and pins outrank both.
    const order = F.buckets.working
      .slice()
      .sort((x, y) => (y.loopSleeping ? 1 : 0) - (x.loopSleeping ? 1 : 0) || y.startedAgo - x.startedAgo);
    pinFirst(order).forEach((a) => {
      el.body.appendChild(
        strip(a, {
          summary: a.detail || 'Working',
          note: a.loopSleeping ? sleepNote(a) : a.alive ? null : 'exited · reply restarts',
          age: F.ageLabel(a.startedAgo),
        }),
      );
    });
    return el;
  }

  function reviewBay() {
    const el = bay(
      'review',
      'To review',
      F.counts.review,
      affordance('is-latched', [
        unreviewedCount() + ' unreviewed',
        h('span', 'legend-dot', '·'),
        kbd('R'),
        'review',
        h('span', 'legend-dot', '·'),
        kbd('⏎'),
        'cycle',
      ]),
      'seen ≠ reviewed — strips stay until reviewed',
    );
    pinFirst(reviewByFinish).forEach((a) => {
      const done = ui.reviewed.has(a.id);
      const tail = F.fakeTail(a);
      el.body.appendChild(
        strip(a, {
          summary: (done ? 'Reviewed · ' : 'Finished · ') + tail[tail.length - 1],
          age: F.ageLabel(a.durationMs) + ' run',
          pulse: !done,
          tag: done ? 'reviewed' : null,
          hovered: !done && ui.hoverId === a.id,
          actions:
            !done && ui.hoverId === a.id
              ? [
                  { label: 'Mark reviewed', run: () => markReviewed(a.id) },
                  { label: 'Review diff', run: () => {} },
                ]
              : null,
        }),
      );
    });
    return el;
  }

  function doneBay() {
    const withPr = doneByFinish.filter((a) => a.pr).slice(0, 2);
    const rest = doneByFinish.filter((a) => !withPr.includes(a)).slice(0, 2);
    const visible = ui.doneUnfolded
      ? doneByFinish
      : withPr.concat(rest).sort((x, y) => y.completedAt - x.completedAt);
    const hidden = F.counts.done - visible.length;

    const el = bay(
      'done',
      'Done',
      F.counts.done,
      affordance(null, [doneByFinish.filter((a) => a.pr).length + ' with PRs', h('span', 'legend-dot', '·'), 'ages frozen at finish']),
    );
    visible.forEach((a) => {
      const tail = F.fakeTail(a);
      el.body.appendChild(
        strip(a, { summary: 'Finished · ' + tail[tail.length - 1], age: F.ageLabel(a.durationMs) + ' run' }),
      );
    });

    if (hidden > 0 || ui.doneUnfolded) {
      const fold = h('div', 'fold-row');
      fold.appendChild(h('span', 'fold-count', ui.doneUnfolded ? '▾ fold ' + F.counts.done + ' done' : '… ' + hidden + ' more'));
      fold.appendChild(h('span', 'legend-dot', '·'));
      fold.appendChild(h('span', null, 'PRs and failures never fold'));
      fold.appendChild(h('span', 'fold-rule', ui.doneUnfolded ? 'showing all' : 'click to unfold'));
      fold.addEventListener('click', () => {
        ui.doneUnfolded = !ui.doneUnfolded;
        render();
      });
      el.body.appendChild(fold);
    }
    return el;
  }

  // ---- actions --------------------------------------------------------------
  function togglePin(id) {
    if (ui.pins.has(id)) ui.pins.delete(id);
    else ui.pins.add(id);
    render();
  }
  function answer(id, label) {
    ui.answered.set(id, label);
    ui.peekId = null;
    render();
  }
  function markReviewed(id) {
    ui.reviewed.add(id);
    if (ui.hoverId === id) {
      const next = pinFirst(reviewByFinish).find((a) => !ui.reviewed.has(a.id));
      ui.hoverId = next ? next.id : null;
    }
    render();
  }
  function needsYouStrips() {
    return pinFirst(attention).concat(failed).filter((a) => !ui.answered.has(a.id));
  }
  function cycleNeedsYou() {
    const list = needsYouStrips();
    if (!list.length) return;
    const i = list.findIndex((a) => a.id === ui.focusId);
    const next = list[(i + 1) % list.length];
    ui.focusId = next.id;
    ui.peekId = next.question ? next.id : null;
    render(next.id);
  }
  function cycleReview() {
    const list = pinFirst(reviewByFinish).filter((a) => !ui.reviewed.has(a.id));
    if (!list.length) return;
    const i = list.findIndex((a) => a.id === ui.hoverId);
    ui.hoverId = list[(i + 1) % list.length].id;
    render(ui.hoverId);
  }

  // ---- chrome ---------------------------------------------------------------
  function renderTopbar() {
    document.getElementById('accounting').textContent =
      F.counts.total + ' of ' + F.counts.fleetTotal + ' agents · ' +
      F.byWorktree.length + ' of ' + F.counts.fleetWorktrees + ' worktrees';

    const pill = document.getElementById('needsPill');
    pill.textContent = '';
    const n = unackedCount();
    pill.title = 'Unacknowledged work. Acknowledged failures stay in the bay until they are resolved.';
    pill.classList.toggle('is-clear', n === 0);
    pill.appendChild(h('span', 'pill-glyph', n === 0 ? '✔' : '?'));
    pill.appendChild(h('span', null, n === 0 ? 'all clear' : n + ' need you'));
    if (n > 0) {
      pill.appendChild(h('span', 'pill-sep', '·'));
      pill.appendChild(kbd('⏎'));
      pill.appendChild(h('span', 'pill-sep', 'next'));
    }
  }

  function renderFooter() {
    const keys = document.getElementById('legendKeys');
    keys.textContent = '';
    [
      ['Space', 'peek'],
      ['⏎', 'attach'],
      ['1–3', 'answer'],
      ['P', 'pin'],
      ['R', 'mark reviewed'],
      ['F', 'next needs-you'],
      [MOD + 'K', 'search'],
    ].forEach(([k, label], i) => {
      if (i) keys.appendChild(h('span', 'sep', '·'));
      keys.appendChild(kbd(k));
      keys.appendChild(h('span', null, label));
    });
  }

  const baysEl = document.getElementById('bays');
  function render(scrollToId) {
    const scroll = {};
    baysEl.querySelectorAll('.bay-body').forEach((b) => {
      scroll[b.dataset.bay] = b.scrollTop;
    });
    baysEl.textContent = '';
    [needsYouBay(), workingBay(), reviewBay(), doneBay()].forEach((b) => {
      baysEl.appendChild(b);
      if (scroll[b.body.dataset.bay]) b.body.scrollTop = scroll[b.body.dataset.bay];
    });
    renderTopbar();
    if (scrollToId) {
      const el = baysEl.querySelector('[data-id="' + CSS.escape(scrollToId) + '"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }

  document.getElementById('needsPill').addEventListener('click', cycleNeedsYou);

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const focused = F.agents.find((a) => a.id === ui.focusId);
    if (e.key === ' ') {
      e.preventDefault();
      if (focused && focused.question) ui.peekId = ui.peekId === focused.id ? null : focused.id;
      render();
    } else if (e.key === 'Escape') {
      ui.peekId = null;
      render();
    } else if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
      cycleNeedsYou();
    } else if (e.key === 'p' || e.key === 'P') {
      if (focused) togglePin(focused.id);
    } else if (e.key === 'r' || e.key === 'R') {
      if (ui.hoverId) markReviewed(ui.hoverId);
      else cycleReview();
    } else if (/^[1-3]$/.test(e.key)) {
      const peeked = F.agents.find((a) => a.id === ui.peekId);
      const option = peeked && peeked.question.options[Number(e.key) - 1];
      if (option) answer(peeked.id, option);
    }
  });

  renderFooter();
  render();
})();
