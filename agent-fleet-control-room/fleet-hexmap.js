/* Fleet Hexmap — a Datadog-host-map-style honeycomb, one cell per agent.
   The field itself is wordless: hue, glyph and motion carry state. Every label
   lives in the hover tooltip or the selection panel. */
(function () {
  'use strict';

  const F = window.FLEET;
  if (!F) throw new Error('fleet-state-synthesis.js must be loaded first');

  const IS_MAC = navigator.userAgent.includes('Mac');

  // Pointy-top honeycomb: 18 columns lands orca on 4 near-full rows (18·3 + 15),
  // so every strip keeps a clean silhouette instead of a stub last row.
  const COLS = 18;
  const HEX_W = 52;
  const GAP = 4;
  const HEX_H = (HEX_W * 2) / Math.sqrt(3);
  const PITCH_X = HEX_W + GAP;
  const PITCH_Y = HEX_H * 0.75 + GAP;
  const FIELD_W = COLS * PITCH_X - GAP + PITCH_X / 2;

  const STATE_LABEL = {
    attention: 'Waiting on your answer',
    permission: 'Waiting on permission',
    failed: 'Failed',
    working: 'Working',
    review: 'Ready to review',
    done: 'Done',
  };

  const el = {
    field: document.getElementById('field'),
    lineage: document.getElementById('lineage'),
    chips: document.getElementById('chips'),
    accounting: document.getElementById('accounting'),
    whisper: document.getElementById('whisper'),
    search: document.getElementById('search'),
    panel: document.getElementById('panel'),
    tip: document.getElementById('tip'),
  };

  const byId = new Map(F.agents.map((a) => [a.id, a]));
  const childrenOf = new Map();
  for (const a of F.agents) {
    if (a.parent && byId.has(a.parent)) {
      if (!childrenOf.has(a.parent)) childrenOf.set(a.parent, []);
      childrenOf.get(a.parent).push(a.id);
    }
  }
  const nodeOf = new Map();
  let selectedId = null;

  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const clock = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const liveness = (a) =>
    a.loopSleeping ? 'loop sleeping' : a.alive ? 'process live' : 'process exited';

  // ---- chrome ----------------------------------------------------------------

  function renderChrome() {
    const c = F.counts;
    const chips = [
      { n: c.needsYou, lbl: 'need you', hue: 'var(--state-attention)', loud: true },
      { n: c.working, lbl: 'working', hue: 'var(--state-working)' },
      { n: c.review, lbl: 'to review', hue: 'var(--state-done)' },
      { n: c.done, lbl: 'done', hue: 'var(--state-idle)' },
    ];
    el.chips.innerHTML = chips
      .map(
        (x) =>
          '<span class="chip' +
          (x.loud ? ' is-loud' : '') +
          '" style="--hue:' +
          x.hue +
          '"><i class="dot"></i><span class="n">' +
          x.n +
          '</span><span class="lbl">' +
          x.lbl +
          '</span></span>',
      )
      .join('<span class="sep">·</span>');

    el.search.placeholder = 'Filter… ' + (IS_MAC ? '⌘K' : 'Ctrl+K');
    el.accounting.textContent =
      c.total + ' / ' + c.fleetTotal + ' agents · ' + F.byWorktree.length + ' / ' + c.fleetWorktrees + ' worktrees';

    const keys = [
      ['var(--state-attention)', 'amber = needs you'],
      ['var(--state-working)', 'gold = working'],
      ['var(--state-done)', 'green = review'],
      ['var(--state-idle)', 'dark = done'],
    ];
    el.whisper.innerHTML =
      keys
        .map((k) => '<span class="key"><i class="dot" style="--hue:' + k[0] + '"></i>' + k[1] + '</span>')
        .join('<span class="sep">·</span>') + '<span class="sep">·</span><span>still = settled</span>';
  }

  // ---- field -----------------------------------------------------------------

  function markup(a) {
    if (a.state === 'done') return '';
    if (a.state === 'working')
      return a.loopSleeping ? '<i class="crescent"></i>' : '<i class="ring"></i>';
    return '<span class="glyph">' + F.stateGlyph(a.state) + '</span>';
  }

  function renderField() {
    el.field.style.width = FIELD_W + 'px';
    for (const p of F.projects) {
      const rows = Math.ceil(p.agents.length / COLS);
      const section = document.createElement('section');
      section.className = 'section';
      const label = document.createElement('p');
      label.className = 'eyebrow section-label';
      label.textContent = p.name.toUpperCase() + ' · ' + p.agents.length;
      const plane = document.createElement('div');
      plane.className = 'plane';
      plane.style.height = (rows - 1) * PITCH_Y + HEX_H + 'px';

      p.agents.forEach((a, i) => {
        const r = Math.floor(i / COLS);
        const c = i % COLS;
        const hex = document.createElement('div');
        hex.className = 'hex' + (a.alive ? '' : ' is-dead');
        hex.dataset.agent = a.id;
        hex.dataset.state = a.state;
        hex.style.left = c * PITCH_X + (r % 2) * (PITCH_X / 2) + 'px';
        hex.style.top = r * PITCH_Y + 'px';
        hex.tabIndex = 0;
        hex.setAttribute('role', 'button');
        hex.setAttribute(
          'aria-label',
          a.shortName + ' — ' + STATE_LABEL[a.state] + ', ' + p.name + '/' + a.worktree,
        );
        hex.innerHTML =
          '<i class="hex-glow"></i><i class="hex-edge"></i><i class="hex-face"></i>' +
          '<i class="hex-mark">' + markup(a) + '</i>';
        plane.appendChild(hex);
        nodeOf.set(a.id, hex);
      });

      section.append(label, plane);
      el.field.appendChild(section);
    }
  }

  // ---- tooltip ---------------------------------------------------------------

  function showTip(node, a) {
    el.tip.style.setProperty('--hue', 'var(' + F.stateColorVar(a.state) + ')');
    el.tip.innerHTML =
      '<div class="t-name">' + esc(a.shortName) + '</div>' +
      '<div class="t-state">' + STATE_LABEL[a.state] +
      '<span class="live">· ' + liveness(a) + '</span></div>' +
      '<div class="t-meta"><span class="mono">' + esc(a.displayProject) + ' / ' + esc(a.worktree) + '</span><br />' +
      'started ' + F.ageLabel(a.startedAgo) + ' ago · ran ' + F.ageLabel(a.durationMs) +
      '<br />' + esc(a.detail || '—') + '</div>';
    el.tip.hidden = false;

    const r = node.getBoundingClientRect();
    const t = el.tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.bottom + 8;
    if (y + t.height > window.innerHeight - 8) y = r.top - t.height - 8;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    el.tip.style.left = x + 'px';
    el.tip.style.top = y + 'px';
  }

  function hideTip() {
    el.tip.hidden = true;
  }

  // ---- lineage ---------------------------------------------------------------

  function centerOf(id) {
    const node = nodeOf.get(id);
    if (!node) return null;
    const base = el.field.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
  }

  function drawLineage() {
    const base = el.field.getBoundingClientRect();
    el.lineage.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);
    if (!selectedId) {
      el.lineage.innerHTML = '';
      return;
    }
    const sel = byId.get(selectedId);
    const from = centerOf(selectedId);
    if (!from) return;
    const kin = (childrenOf.get(selectedId) || []).slice();
    if (sel.parent && byId.has(sel.parent)) kin.unshift(sel.parent);

    let svg = '';
    for (const id of kin) {
      const to = centerOf(id);
      if (!to) continue;
      const bend = (to.y - from.y) * 0.45;
      svg +=
        '<path d="M' + from.x + ' ' + from.y + 'C' + from.x + ' ' + (from.y + bend) +
        ',' + to.x + ' ' + (to.y - bend) + ',' + to.x + ' ' + to.y +
        '" fill="none" stroke="var(--muted-foreground)" stroke-width="1" opacity="0.5" />' +
        '<circle cx="' + to.x + '" cy="' + to.y + '" r="2.5" fill="var(--muted-foreground)" opacity="0.7" />';
    }
    el.lineage.innerHTML = svg;
  }

  // ---- selection panel -------------------------------------------------------

  function tailHtml(a) {
    const lines = F.fakeTail(a);
    const padded = new Array(Math.max(0, 8 - lines.length)).fill('').concat(lines.slice(-8));
    let lastIdx = -1;
    padded.forEach((l, i) => {
      if (l.trim()) lastIdx = i;
    });
    return padded
      .map((l, i) => '<div' + (i === lastIdx ? ' class="last"' : '') + '>' + (esc(l) || '&nbsp;') + '</div>')
      .join('');
  }

  function respondHtml(a) {
    if (a.state === 'attention') {
      const opts = a.question.options
        .map((o, i) => '<button class="opt" type="button"><span class="num">' + (i + 1) + '</span>' + esc(o) + '</button>')
        .join('');
      return (
        '<p class="p-ask">' + esc(a.question.text) + '</p><div class="opts">' + opts + '</div>' +
        '<div class="reply"><input type="text" placeholder="Or answer in your own words…" aria-label="Reply" />' +
        '<button class="btn is-primary" type="button">Send</button></div>'
      );
    }
    if (a.state === 'permission') {
      const d = F.decisions.find((x) => x.key === a.decisionKey);
      return (
        '<p class="p-cmd">$ ' + esc(d ? d.command : '') + '</p>' +
        '<div class="btnrow"><button class="btn is-primary" type="button">Allow once</button>' +
        '<button class="btn" type="button">Allow for project</button>' +
        '<button class="btn is-danger" type="button">Deny</button></div>'
      );
    }
    if (a.state === 'failed') {
      return (
        '<p class="p-fail">' + esc(a.failure) + '</p>' +
        '<div class="btnrow"><button class="btn is-primary" type="button">Retry</button>' +
        '<button class="btn" type="button">Open terminal</button></div>'
      );
    }
    if (a.state === 'review') {
      return (
        '<div class="btnrow"><button class="btn is-primary" type="button">Review diff' +
        (a.pr ? ' #' + a.pr.number : '') + '</button>' +
        '<button class="btn" type="button">Mark reviewed</button></div>'
      );
    }
    if (a.state === 'working') {
      return (
        '<div class="reply"><input type="text" placeholder="Queue a message…" aria-label="Queue a message" />' +
        '<button class="btn is-danger" type="button">Interrupt</button></div>'
      );
    }
    return '<div class="btnrow"><button class="btn" type="button">Open terminal</button></div>';
  }

  function renderPanel(a) {
    if (!a) {
      el.panel.classList.remove('is-open');
      el.panel.setAttribute('aria-hidden', 'true');
      return;
    }
    el.panel.style.setProperty('--hue', 'var(' + F.stateColorVar(a.state) + ')');
    el.panel.innerHTML =
      '<button class="panel-close" type="button" aria-label="Close">×</button>' +
      '<div class="panel-body">' +
      '<h2 class="p-name">' + esc(a.shortName) + '</h2>' +
      '<div class="p-state"><i class="dot"></i>' + STATE_LABEL[a.state] +
      '<span class="live">· ' + liveness(a) + '</span></div>' +
      '<p class="p-path">' + esc(a.displayProject) + ' / ' + esc(a.worktree) + '</p>' +
      '<div class="p-facts">' +
      '<div><div class="eyebrow">Started</div><div class="v">' + clock(a.startedAt) + '</div></div>' +
      '<div><div class="eyebrow">Elapsed</div><div class="v">' + F.ageLabel(a.startedAgo) + '</div></div>' +
      '<div><div class="eyebrow">Duration</div><div class="v">' + F.ageLabel(a.durationMs) + '</div></div>' +
      '</div>' +
      '<div class="p-tail">' + tailHtml(a) + '</div>' +
      '</div>' +
      '<div class="p-respond">' + respondHtml(a) + '</div>';
    el.panel.classList.add('is-open');
    el.panel.setAttribute('aria-hidden', 'false');
    el.panel.querySelector('.panel-close').addEventListener('click', () => select(null));
  }

  function select(id) {
    if (selectedId && nodeOf.has(selectedId)) nodeOf.get(selectedId).classList.remove('is-selected');
    selectedId = id;
    if (id && nodeOf.has(id)) nodeOf.get(id).classList.add('is-selected');
    renderPanel(id ? byId.get(id) : null);
    drawLineage();
  }

  // ---- search ----------------------------------------------------------------

  function applySearch(raw) {
    const q = raw.trim().toLowerCase();
    for (const a of F.agents) {
      const node = nodeOf.get(a.id);
      if (!node) continue;
      const hit =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.worktree.toLowerCase().includes(q) ||
        a.displayProject.toLowerCase().includes(q) ||
        a.agentType.toLowerCase().includes(q) ||
        a.state.includes(q) ||
        STATE_LABEL[a.state].toLowerCase().includes(q);
      node.classList.toggle('is-dim', Boolean(q) && !hit);
    }
  }

  // ---- wiring ----------------------------------------------------------------

  renderChrome();
  renderField();

  el.field.addEventListener('click', (e) => {
    const node = e.target.closest('[data-agent]');
    if (!node) return;
    select(node.dataset.agent === selectedId ? null : node.dataset.agent);
  });
  el.field.addEventListener('mouseover', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.field.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-agent]')) hideTip();
  });
  el.field.addEventListener('focusin', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.field.addEventListener('focusout', hideTip);
  el.field.addEventListener('keydown', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      select(node.dataset.agent === selectedId ? null : node.dataset.agent);
    }
  });

  el.search.addEventListener('input', () => applySearch(el.search.value));
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'k' && (IS_MAC ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      el.search.focus();
      el.search.select();
      return;
    }
    if (e.key === 'Escape') {
      if (document.activeElement === el.search && el.search.value) {
        el.search.value = '';
        applySearch('');
      } else if (selectedId) {
        select(null);
      }
      hideTip();
    }
  });
  window.addEventListener('resize', drawLineage);

  // Pre-seed the one attention agent whose parent resolves, so the first paint
  // carries the ring, a cross-section lineage line and the numbered reply panel.
  const seed =
    F.agents.find((a) => a.state === 'attention' && ((a.parent && byId.has(a.parent)) || childrenOf.has(a.id))) ||
    F.agents.find((a) => a.state === 'attention' && a.pinned) ||
    F.buckets.needsYou[0];
  select(seed ? seed.id : null);
  requestAnimationFrame(() => requestAnimationFrame(drawLineage));
})();
