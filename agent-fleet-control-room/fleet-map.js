/* Containment map. Everything on screen is derived from window.FLEET; ages come from
   FLEET.now (the capture time) so the render is byte-identical on every reload. */
(function () {
  'use strict';

  const F = window.FLEET;
  if (!F) throw new Error('fleet-state-synthesis.js must be loaded first');

  const IS_MAC = navigator.userAgent.includes('Mac');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';

  const STATE_LABEL = {
    attention: 'Needs an answer',
    permission: 'Awaiting permission',
    failed: 'Failed',
    working: 'Working',
    review: 'Ready to review',
    done: 'Done',
  };
  const NEEDS_YOU = { attention: 1, permission: 1, failed: 1 };
  // FLEET maps done → --state-idle; the spec wants a quiet gray-emerald, so mix, don't invent.
  const DONE_COLOR = 'color-mix(in srgb, var(--state-done) 32%, var(--ring))';

  const byId = new Map(F.agents.map((a) => [a.id, a]));
  const childrenOf = new Map();
  for (const a of F.agents) {
    if (a.parent && byId.has(a.parent)) {
      if (!childrenOf.has(a.parent)) childrenOf.set(a.parent, []);
      childrenOf.get(a.parent).push(a.id);
    }
  }

  const el = {
    accounting: document.getElementById('accounting'),
    dials: document.getElementById('dials'),
    bands: document.getElementById('bands'),
    lineage: document.getElementById('lineage'),
    legend: document.getElementById('legend'),
    detail: document.getElementById('detail'),
    tooltip: document.getElementById('tooltip'),
    search: document.getElementById('search'),
    searchKbd: document.getElementById('search-kbd'),
    matchChip: document.getElementById('match-chip'),
    canvas: document.querySelector('.canvas'),
  };

  let selectedId = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }
  function colorFor(state) {
    return state === 'done' ? DONE_COLOR : 'var(' + F.stateColorVar(state) + ')';
  }
  function livenessLabel(a) {
    if (a.loopSleeping) return 'loop sleeping';
    return a.alive ? 'process live' : 'process exited';
  }
  function clockLabel(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ---- glyph -----------------------------------------------------------------

  function glyphBody(a) {
    if (a.loopSleeping) return '<span class="g crescent"></span>';
    if (a.state === 'working') return '<span class="g ring"></span>';
    if (a.state === 'done') return '<span class="g dot"></span>';
    return '<span class="g">' + esc(F.stateGlyph(a.state)) + '</span>';
  }

  function glyphClasses(a) {
    const c = ['glyph', 'st-' + a.state];
    if (!a.alive) c.push('is-dead');
    // Only an UNACKNOWLEDGED needs-you agent gets the fast blink.
    if (NEEDS_YOU[a.state] && a.unread) c.push(a.state === 'failed' ? 'blink-blocked' : 'blink-attention');
    if (a.state === 'review') c.push('pulse-review');
    return c.join(' ');
  }

  function glyphHtml(a, interactive) {
    const tag = interactive ? 'button' : 'span';
    return (
      '<' + tag + ' class="' + glyphClasses(a) + '" style="--sc:' + colorFor(a.state) + '"' +
      (interactive ? ' data-agent="' + esc(a.id) + '" aria-label="' + esc(a.shortName) + '"' : ' aria-hidden="true"') +
      '>' + glyphBody(a) + '</' + tag + '>'
    );
  }

  // Legend/detail need a glyph for a state with no particular agent behind it.
  function stateChip(state) {
    const fake = { state, alive: true, loopSleeping: false, unread: false, shortName: '' };
    return '<span class="glyph st-' + state + '" style="--sc:' + colorFor(state) + '" aria-hidden="true">' + glyphBody(fake) + '</span>';
  }

  // ---- top bar + dials -------------------------------------------------------

  function renderChrome() {
    el.searchKbd.textContent = MOD + 'K';
    el.accounting.innerHTML =
      '<b>' + F.counts.total + '</b> of ' + F.counts.fleetTotal + ' agents · ' +
      '<b>' + F.byWorktree.length + '</b> of ' + F.counts.fleetWorktrees + ' worktrees · captured ' +
      new Date(F.now).toISOString().slice(11, 16) + ' UTC';

    const dials = [
      { key: 'needsYou', label: 'Needs you', n: F.counts.needsYou, cls: 'is-needs' },
      { key: 'working', label: 'Working', n: F.counts.working, cls: '' },
      { key: 'review', label: 'To review', n: F.counts.review, cls: 'is-review', delta: true },
      { key: 'done', label: 'Done', n: F.counts.done, cls: '' },
    ];
    el.dials.innerHTML = dials
      .map(
        (d) =>
          '<article class="dial ' + d.cls + (d.n === 0 ? ' is-zero' : '') + '">' +
          '<span class="dial-head"><strong>' + d.n + '</strong>' +
          (d.delta && d.n > 0 ? '<span class="delta" aria-label="trending up">↑</span>' : '') +
          '</span>' +
          '<span class="eyebrow">' + esc(d.label) + '</span>' +
          '</article>'
      )
      .join('');
  }

  // ---- bands -----------------------------------------------------------------

  function renderBands() {
    el.bands.innerHTML = F.projects
      .map((p) => {
        const cells = p.worktrees
          .map(
            (g) =>
              '<article class="cell worst-' + g.worstState + '" data-worktree="' + esc(g.project + '/' + g.worktree) + '">' +
              '<header class="cell-head">' +
              '<span class="cell-name" title="' + esc(g.worktree) + '">' + esc(g.worktree) + '</span>' +
              (g.unread ? '<i class="unread-dot" title="unread output"></i>' : '') +
              '<b class="cell-count">' + g.agents.length + '</b>' +
              '</header>' +
              '<div class="cell-glyphs">' + g.agents.map((a) => glyphHtml(a, true)).join('') + '</div>' +
              '</article>'
          )
          .join('');
        return (
          '<section class="band worst-' + p.worstState + (p.name === 'orca' ? ' grows' : '') + '">' +
          '<header class="band-head">' +
          '<span class="eyebrow">' + esc(p.name) + '</span>' +
          '<span class="band-meta">' + p.worktrees.length + ' worktrees · ' + p.agents.length + ' agents</span>' +
          '</header>' +
          '<div class="band-cells">' + (cells || '<p class="band-empty">No worktrees in this project.</p>') + '</div>' +
          '</section>'
        );
      })
      .join('');
  }

  function renderLegend() {
    const states = ['attention', 'permission', 'failed', 'working', 'review', 'done'];
    el.legend.innerHTML =
      states
        .map((s) => '<span class="legend-item">' + stateChip(s) + esc(STATE_LABEL[s]) + '</span>')
        .join('') +
      '<span class="legend-motion">fast blink = needs you · slow pulse = awaiting review · still = settled</span>';
  }

  // ---- tooltip ---------------------------------------------------------------

  function showTooltip(node, a) {
    el.tooltip.innerHTML =
      '<p class="tt-name">' + esc(a.shortName) + '</p>' +
      '<p class="tt-state">' + stateChip(a.state) + esc(STATE_LABEL[a.state]) + ' · ' + esc(livenessLabel(a)) + '</p>' +
      '<dl>' +
      '<dt>Runner</dt><dd>' + esc(a.agentType) + '</dd>' +
      '<dt>Started</dt><dd>' + esc(F.ageLabel(a.startedAgo)) + ' ago</dd>' +
      '<dt>Duration</dt><dd>' + esc(F.ageLabel(a.durationMs)) + '</dd>' +
      '<dt>Doing</dt><dd>' + esc(a.detail || '—') + '</dd>' +
      '</dl>';
    el.tooltip.hidden = false;
    const r = node.getBoundingClientRect();
    const t = el.tooltip.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    let top = r.bottom + 8;
    if (top + t.height > window.innerHeight - 8) top = r.top - t.height - 8;
    el.tooltip.style.left = left + 'px';
    el.tooltip.style.top = top + 'px';
  }
  function hideTooltip() {
    el.tooltip.hidden = true;
  }

  // ---- detail panel ----------------------------------------------------------

  function respondHtml(a) {
    if (a.state === 'attention' && a.question) {
      return (
        '<span class="eyebrow">Respond in place</span>' +
        '<p class="question">' + esc(a.question.text) + '</p>' +
        '<div class="options">' +
        a.question.options
          .map((o, i) => '<button class="opt" type="button"><kbd>' + (i + 1) + '</kbd><span>' + esc(o) + '</span></button>')
          .join('') +
        '</div>' +
        '<div class="reply-row"><input placeholder="Reply…" aria-label="Reply to this agent" />' +
        '<button class="btn primary" type="button">Send</button></div>'
      );
    }
    if (a.state === 'permission') {
      const d = F.decisions.find((x) => x.key === a.decisionKey);
      return (
        '<span class="eyebrow">Permission requested</span>' +
        (d ? '<code class="cmd">' + esc(d.command) + '</code><p class="question">' + esc(d.detail) + '</p>' : '') +
        '<div class="btn-row"><button class="btn" type="button">Allow once</button>' +
        '<button class="btn" type="button">Allow for project</button>' +
        '<button class="btn ghost" type="button">Deny</button></div>'
      );
    }
    if (a.state === 'failed') {
      return (
        '<span class="eyebrow">Failure</span>' +
        '<p class="failure">' + esc(a.failure || 'Process exited unexpectedly.') + '</p>' +
        '<div class="btn-row"><button class="btn" type="button">Retry</button>' +
        '<button class="btn ghost" type="button">Open terminal</button></div>'
      );
    }
    if (a.state === 'review') {
      return (
        '<span class="eyebrow">Finished · awaiting review</span>' +
        (a.pr ? '<span class="pr-chip">PR #' + a.pr.number + ' · ' + esc(a.pr.state) + '</span>' : '') +
        '<div class="btn-row"><button class="btn primary" type="button">Review diff</button>' +
        '<button class="btn" type="button">Mark reviewed</button>' +
        '<button class="btn ghost" type="button">Reopen</button></div>'
      );
    }
    if (a.state === 'working') {
      return (
        '<span class="eyebrow">In flight</span>' +
        '<div class="reply-row"><input placeholder="Queue a message…" aria-label="Queue a message" />' +
        '<button class="btn ghost" type="button">Interrupt</button></div>'
      );
    }
    return (
      '<span class="eyebrow">Settled</span>' +
      (a.pr ? '<span class="pr-chip">PR #' + a.pr.number + ' · ' + esc(a.pr.state) + '</span>' : '') +
      '<div class="btn-row"><button class="btn ghost" type="button">Open terminal</button></div>'
    );
  }

  const TAIL_LINES = 9;

  function renderDetail() {
    if (!selectedId) {
      el.detail.innerHTML =
        '<p class="detail-empty"><strong>Select an agent</strong>click any glyph</p>';
      return;
    }
    const a = byId.get(selectedId);
    const tail = F.fakeTail(a);
    const pad = Math.max(0, TAIL_LINES - tail.length);
    const tailHtml =
      Array(pad).fill('').concat(tail).map((line, i, all) =>
        i === all.length - 1 ? '<span class="last">' + esc(line) + '</span>' : esc(line)
      ).join('\n');

    el.detail.innerHTML =
      '<span class="eyebrow">Selected agent</span>' +
      '<h2 class="detail-name">' + esc(a.name) + '</h2>' +
      '<p class="detail-state">' + stateChip(a.state) + esc(STATE_LABEL[a.state]) +
      '<small>· ' + esc(livenessLabel(a)) + '</small></p>' +
      '<p class="detail-path">' + esc(a.displayProject) + ' / ' + esc(a.worktree) + '</p>' +
      '<div class="facts">' +
      '<div><span class="eyebrow">Started</span><b>' + clockLabel(a.startedAt) + '</b></div>' +
      '<div><span class="eyebrow">Elapsed</span><b>' + esc(F.ageLabel(a.startedAgo)) + '</b></div>' +
      '<div><span class="eyebrow">Duration</span><b>' + esc(F.ageLabel(a.durationMs)) + '</b></div>' +
      '<div><span class="eyebrow">Runner</span><b>' + esc(a.agentType) + '</b></div>' +
      '</div>' +
      '<pre class="tail">' + tailHtml + '</pre>' +
      '<div class="respond">' + respondHtml(a) + '</div>';
  }

  // ---- lineage overlay -------------------------------------------------------

  // Selector lookups on ids/worktree names full of #, spaces and em-dashes are fragile;
  // index the nodes once instead.
  const glyphNodes = new Map();
  const cellNodes = new Map();
  function indexNodes() {
    glyphNodes.clear();
    cellNodes.clear();
    el.bands.querySelectorAll('[data-agent]').forEach((n) => glyphNodes.set(n.dataset.agent, n));
    el.bands.querySelectorAll('[data-worktree]').forEach((n) => cellNodes.set(n.dataset.worktree, n));
  }
  function glyphNode(id) {
    return glyphNodes.get(id) || null;
  }

  function drawLineage() {
    el.lineage.innerHTML = '';
    el.bands.querySelectorAll('.glyph.is-kin').forEach((n) => n.classList.remove('is-kin'));
    if (!selectedId) return;

    const from = glyphNode(selectedId);
    if (!from) return;
    const sel = byId.get(selectedId);
    const kin = (childrenOf.get(selectedId) || []).slice();
    if (sel.parent && byId.has(sel.parent)) kin.unshift(sel.parent);
    if (!kin.length) return;

    const base = el.canvas.getBoundingClientRect();
    el.lineage.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);
    const center = (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
    };
    const a = center(from);
    let svg = '';
    for (const id of kin) {
      const node = glyphNode(id);
      if (!node) continue;
      node.classList.add('is-kin');
      const b = center(node);
      const bow = Math.max(30, Math.abs(b.x - a.x) * 0.4);
      const dir = b.x >= a.x ? 1 : -1;
      svg +=
        '<path d="M ' + a.x + ' ' + a.y + ' C ' + (a.x + bow * dir) + ' ' + a.y + ', ' +
        (b.x - bow * dir) + ' ' + b.y + ', ' + b.x + ' ' + b.y + '" />' +
        '<circle cx="' + b.x + '" cy="' + b.y + '" r="1.6" />';
    }
    el.lineage.innerHTML = svg;
  }

  // ---- selection -------------------------------------------------------------

  function select(id, opts) {
    selectedId = id;
    el.bands.querySelectorAll('.glyph.is-selected').forEach((n) => n.classList.remove('is-selected'));
    const node = id && glyphNode(id);
    if (node) node.classList.add('is-selected');
    renderDetail();
    if (opts && opts.reveal && node) {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const sel = byId.get(id);
      const kinId = sel.parent && byId.has(sel.parent) ? sel.parent : (childrenOf.get(id) || [])[0];
      const kinNode = kinId && glyphNode(kinId);
      if (kinNode) kinNode.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    requestAnimationFrame(drawLineage);
  }

  // ---- search ----------------------------------------------------------------

  function applySearch(raw) {
    const q = raw.trim().toLowerCase();
    let matches = 0;
    for (const g of F.byWorktree) {
      const cell = cellNodes.get(g.project + '/' + g.worktree);
      if (!cell) continue;
      let cellHits = 0;
      for (const a of g.agents) {
        const node = glyphNode(a.id);
        if (!node) continue;
        const hit =
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.worktree.toLowerCase().includes(q) ||
          a.displayProject.toLowerCase().includes(q) ||
          a.state.includes(q) ||
          STATE_LABEL[a.state].toLowerCase().includes(q);
        node.classList.toggle('dim', Boolean(q) && !hit);
        if (hit) cellHits++;
        if (q && hit) matches++;
      }
      cell.classList.toggle('dim', Boolean(q) && cellHits === 0);
    }
    if (!q) {
      el.matchChip.hidden = true;
    } else {
      el.matchChip.hidden = false;
      el.matchChip.textContent = matches + (matches === 1 ? ' match' : ' matches');
    }
    drawLineage();
  }

  // ---- wiring ----------------------------------------------------------------

  renderChrome();
  renderBands();
  indexNodes();
  renderLegend();

  el.bands.addEventListener('click', (e) => {
    const node = e.target.closest('[data-agent]');
    if (!node) return;
    select(node.dataset.agent === selectedId ? null : node.dataset.agent);
  });
  el.bands.addEventListener('mouseover', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node) showTooltip(node, byId.get(node.dataset.agent));
  });
  el.bands.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-agent]')) hideTooltip();
  });
  el.bands.addEventListener('focusin', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node) showTooltip(node, byId.get(node.dataset.agent));
  });
  el.bands.addEventListener('focusout', hideTooltip);
  // Bands scroll independently, so the overlay geometry has to be recomputed.
  el.bands.addEventListener('scroll', drawLineage, true);
  window.addEventListener('resize', drawLineage);

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
      hideTooltip();
    }
  });

  // Pre-seed: an attention agent with resolvable lineage, so the first paint shows the
  // selection ring, a lineage edge, and the numbered-reply panel together.
  const seed =
    F.agents.find((a) => a.state === 'attention' && ((a.parent && byId.has(a.parent)) || childrenOf.has(a.id))) ||
    F.agents.find((a) => a.state === 'attention' && a.pinned) ||
    F.buckets.needsYou[0];
  select(seed ? seed.id : null, { reveal: true });
  requestAnimationFrame(() => requestAnimationFrame(drawLineage));
})();
