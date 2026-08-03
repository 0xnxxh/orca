/* Fleet · Space — glass worktree cards on an open pan/zoom field. */
(function () {
  'use strict';
  const F = window.FLEET;
  const MAC = navigator.userAgent.includes('Mac');
  const LAYOUT_KEY = 'fleet-space-layout-v1';
  const COL_W = 252;
  const GAP = 18;
  const COLS = { automation: 2, orca: 4, 'orca-mobile': 3 };

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

  // ---- chrome (same as glass) ----------------------------------------------
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

  // ---- world ----------------------------------------------------------------
  const stage = document.getElementById('stage');
  const world = document.getElementById('world');
  const orbEls = new Map();
  const cards = [];
  let selected = null;

  function deltas() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  function saveDelta(key, dx, dy) {
    const d = deltas();
    d[key] = { dx, dy };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(d));
    resetBtn.disabled = false;
  }

  function tailBlock(a, count) {
    const pre = el('pre', 'tail');
    const lines = F.fakeTail(a).slice(-count);
    lines.forEach((ln, i) => pre.append(el('span', i === lines.length - 1 ? 'now' : null, ln + '\n')));
    return pre;
  }

  F.projects.forEach((p) => {
    const region = el('div', 'region');
    region.append(
      el('span', 'r-name', p.name),
      el('span', 'r-meta', p.worktrees.length + ' worktrees · ' + p.agents.length + ' agents'),
    );
    region.dataset.project = p.name;
    world.append(region);

    const wts = p.worktrees.slice().sort((a, b) => {
      const na = F.severityRank(a.worstState) <= 2 ? 0 : 1;
      const nb = F.severityRank(b.worstState) <= 2 ? 0 : 1;
      return na - nb || a.worktree.localeCompare(b.worktree);
    });

    wts.forEach((g) => {
      const card = el('article', 'wt');
      card.dataset.worst = g.worstState;
      card.dataset.project = p.name;
      card.dataset.key = p.name + '/' + g.worktree;
      card.dataset.search = (g.worktree + ' ' + g.agents.map((a) => a.name).join(' ')).toLowerCase();

      const head = el('div', 'wt-head');
      head.append(el('span', 'wt-name', g.worktree), el('span', 'wt-count', String(g.agents.length)));
      card.append(head);

      const orbs = el('div', 'orbs');
      const loud = [];
      g.agents.forEach((a) => {
        const o = el('i', 'orb');
        o.dataset.state = a.state;
        o.addEventListener('click', (e) => {
          e.stopPropagation();
          select(a, o);
        });
        o.addEventListener('mousemove', (e) => showTip(e, a));
        o.addEventListener('mouseleave', hideTip);
        orbs.append(o);
        orbEls.set(a.id, o);
        if (a.bucket === 'needsYou') loud.push(a);
      });
      card.append(orbs);

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
        ask.addEventListener('click', (e) => {
          e.stopPropagation();
          select(a, orbEls.get(a.id));
        });
        card.append(ask);
      });

      world.append(card);
      cards.push({ card, project: p.name, key: card.dataset.key });
    });
  });

  // ---- masonry layout (two-pass: measure real heights, then place) ----------
  const basePos = new Map();
  function layout() {
    const anchors = {};
    let x = 0;
    F.projects.forEach((p) => {
      const cols = COLS[p.name] || 3;
      anchors[p.name] = { x, cols };
      x += cols * (COL_W + GAP) + 110;
    });
    const colHeights = {};
    F.projects.forEach((p) => {
      colHeights[p.name] = new Array(anchors[p.name].cols).fill(64);
    });
    const saved = deltas();
    cards.forEach(({ card, project, key }) => {
      const a = anchors[project];
      const h = card.offsetHeight;
      const heights = colHeights[project];
      let col = 0;
      for (let i = 1; i < heights.length; i++) if (heights[i] < heights[col]) col = i;
      const jx = (F.hash(key + ':x') % 15) - 7;
      const jy = (F.hash(key + ':y') % 17) - 8;
      const bx = a.x + col * (COL_W + GAP) + jx;
      const by = heights[col] + jy;
      basePos.set(key, { x: bx, y: by });
      const d = saved[key] || { dx: 0, dy: 0 };
      card.style.left = bx + d.dx + 'px';
      card.style.top = by + d.dy + 'px';
      heights[col] += h + GAP;
    });
    document.querySelectorAll('.region').forEach((r) => {
      const a = anchors[r.dataset.project];
      r.style.left = a.x + 2 + 'px';
      r.style.top = '10px';
    });
    if (Object.keys(saved).length) resetBtn.disabled = false;
  }

  // ---- pan / zoom -----------------------------------------------------------
  const view = { x: 0, y: 0, k: 1 };
  function apply() {
    world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
  }
  function bounds() {
    let maxX = 0;
    let maxY = 0;
    cards.forEach(({ card }) => {
      maxX = Math.max(maxX, card.offsetLeft + card.offsetWidth);
      maxY = Math.max(maxY, card.offsetTop + card.offsetHeight);
    });
    return { w: maxX + 40, h: maxY + 40 };
  }
  function fit() {
    const b = bounds();
    const r = stage.getBoundingClientRect();
    view.k = Math.max(0.32, Math.min(1, Math.min(r.width / b.w, r.height / b.h)));
    view.x = (r.width - b.w * view.k) / 2;
    view.y = 74;
    apply();
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
    const k = Math.min(1.6, Math.max(0.32, view.k * factor));
    view.x = mx - ((mx - view.x) / view.k) * k;
    view.y = my - ((my - view.y) / view.k) * k;
    view.k = k;
    apply();
  }, { passive: false });

  let drag = null;
  stage.addEventListener('mousedown', (e) => {
    if (e.target.closest('.panel, .viewtools, .orb, .ask')) return;
    const cardEl = e.target.closest('.wt');
    drag = {
      cardEl,
      key: cardEl?.dataset.key,
      sx: e.clientX,
      sy: e.clientY,
      ox: cardEl ? cardEl.offsetLeft : view.x,
      oy: cardEl ? cardEl.offsetTop : view.y,
      moved: false,
    };
    if (!cardEl) stage.classList.add('is-panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    if (drag.cardEl) {
      drag.cardEl.classList.add('is-dragging');
      drag.cardEl.style.left = drag.ox + dx / view.k + 'px';
      drag.cardEl.style.top = drag.oy + dy / view.k + 'px';
    } else {
      view.x = drag.ox + dx;
      view.y = drag.oy + dy;
      apply();
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag?.cardEl && drag.moved) {
      const base = basePos.get(drag.key);
      saveDelta(drag.key, drag.cardEl.offsetLeft - base.x, drag.cardEl.offsetTop - base.y);
      drag.cardEl.classList.remove('is-dragging');
    }
    stage.classList.remove('is-panning');
    drag = null;
  });
  stage.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.wt')) fit();
  });

  const resetBtn = document.getElementById('reset');
  document.getElementById('fit').addEventListener('click', fit);
  resetBtn.addEventListener('click', () => {
    localStorage.removeItem(LAYOUT_KEY);
    resetBtn.disabled = true;
    cards.forEach(({ card, key }) => {
      const b = basePos.get(key);
      card.style.left = b.x + 'px';
      card.style.top = b.y + 'px';
    });
  });

  // ---- tooltip / panel (same behavior as glass) -----------------------------
  const tip = document.getElementById('tooltip');
  function showTip(e, a) {
    tip.hidden = false;
    tip.replaceChildren(
      el('div', 't-name', a.shortName),
      el('div', 't-meta', STATE_LABEL[a.state] + ' · ' + a.agentType + ' · ' +
        F.ageLabel(a.state === 'done' || a.state === 'review' ? a.durationMs : a.startedAgo) +
        (a.detail && a.state === 'working' ? ' · ' + a.detail : '')),
    );
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = e.clientX + 14;
    let y = e.clientY - h - 10;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y < 60) y = e.clientY + 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() {
    tip.hidden = true;
  }

  const panel = document.getElementById('panel');
  function closePanel() {
    panel.hidden = true;
    if (selected) orbEls.get(selected.id)?.classList.remove('is-selected');
    selected = null;
  }
  function select(a, orb) {
    if (selected) orbEls.get(selected.id)?.classList.remove('is-selected');
    selected = a;
    orb?.classList.add('is-selected');
    panel.hidden = false;
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
    cards.forEach(({ card }) => {
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
  whisper.append(el('span', null, 'drag cards to arrange · scroll to zoom · captured ' +
    new Date(F.now).toISOString().slice(11, 16) + ' UTC'));

  // ---- boot: measure, place, fit, seed --------------------------------------
  requestAnimationFrame(() => {
    layout();
    fit();
    const seed = F.projects.flatMap((p) => p.agents).find((a) => a.state === 'attention');
    if (seed) select(seed, orbEls.get(seed.id));
  });
})();
