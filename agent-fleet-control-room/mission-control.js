/* Mission Control — the containment map and the intervention rail are one surface:
   selecting on the map highlights the decision that would unblock it, and acting in the rail
   moves the glyphs on the map. Every number, name and age comes from window.FLEET. */
(function () {
  'use strict';

  const FLEET = window.FLEET;
  if (!FLEET) throw new Error('fleet-state-synthesis.js must be loaded first');

  const IS_MAC = navigator.userAgent.includes('Mac');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const PAUSE_MS = 8000;

  const STATE_LABEL = {
    attention: 'question waiting',
    permission: 'permission waiting',
    failed: 'failed',
    working: 'working',
    review: 'awaiting review',
    done: 'done',
  };
  const LEGEND_ORDER = ['attention', 'permission', 'failed', 'working', 'review', 'done'];
  const LEGEND_LABEL = {
    attention: 'question',
    permission: 'permission',
    failed: 'failed',
    working: 'working',
    review: 'review',
    done: 'done',
  };
  const SCOPES = [
    { id: 'once', label: 'This once' },
    { id: 'project', label: 'This project' },
    { id: 'always', label: 'Always' },
  ];

  const byId = new Map(FLEET.agents.map((a) => [a.id, a]));
  const childrenOf = new Map();
  for (const a of FLEET.agents) {
    if (a.parent && byId.has(a.parent)) {
      if (!childrenOf.has(a.parent)) childrenOf.set(a.parent, []);
      childrenOf.get(a.parent).push(a);
    }
  }

  // ---- mutable view state ----------------------------------------------------
  const resolved = new Set(); // agents the operator has already acted on
  const scopeByDecision = new Map(FLEET.decisions.map((d) => [d.key, 'once']));
  let selectedId = null;
  let expandedDecision = FLEET.decisions.length ? FLEET.decisions[0].key : null;
  let query = '';
  let peek = false;
  let lastInteraction = Date.now();

  const $ = (sel) => document.querySelector(sel);
  const dom = {
    dials: $('#dials'),
    accounting: $('#accounting'),
    bands: $('#bands'),
    map: $('#map'),
    mapEmpty: $('#map-empty'),
    lineage: $('#lineage'),
    rail: $('#rail'),
    tooltip: $('#tooltip'),
    search: $('#search'),
    searchKbd: $('#search-kbd'),
    legendShape: $('#legend-shape'),
    legendKeys: $('#legend-keys'),
    capture: $('#capture'),
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* An agent the operator has answered is no longer waiting on them: a resolved needs-you
     agent goes back to work, a reviewed run goes quiet. Everything else reads from FLEET. */
  function effState(a) {
    if (!resolved.has(a.id)) return a.state;
    return a.bucket === 'review' ? 'done' : 'working';
  }
  const effBucket = (a) => {
    const s = effState(a);
    return s === 'review' ? 'review' : s === 'done' ? 'done' : s === 'working' ? 'working' : 'needsYou';
  };
  const isUnacked = (a) => effBucket(a) === 'needsYou';

  function counts() {
    const c = { needsYou: 0, working: 0, review: 0, done: 0 };
    for (const a of FLEET.agents) c[effBucket(a)]++;
    return c;
  }

  const liveState = (a) =>
    a.loopSleeping ? 'loop sleeping' : a.alive ? 'alive — replies now' : 'exited — restarts on reply';

  function motionFor(state) {
    if (state === 'attention' || state === 'permission' || state === 'failed') return 'blink';
    if (state === 'review') return 'pulse';
    return 'still';
  }

  const openList = (state) =>
    FLEET.agents.filter((a) => a.state === state && !resolved.has(a.id));
  const openDecisions = () =>
    FLEET.decisions
      .map((d) => ({ decision: d, agents: d.agents.filter((a) => !resolved.has(a.id)) }))
      .filter((d) => d.agents.length > 0);

  // ---- glyphs ----------------------------------------------------------------

  function glyph(a, opts) {
    const options = opts || {};
    const state = effState(a);
    const node = el(options.static ? 'span' : 'button', 'glyph');
    if (!options.static) node.type = 'button';
    node.dataset.state = state;
    node.dataset.live = a.loopSleeping ? 'sleeping' : a.alive ? 'alive' : 'exited';
    node.dataset.motion = options.static ? 'still' : motionFor(state);
    node.dataset.agent = a.id;
    node.setAttribute('aria-label', a.shortName + ' — ' + STATE_LABEL[state] + ', ' + liveState(a));

    if (a.loopSleeping) node.append(el('i', 'g-crescent'));
    else if (state === 'working') node.append(el('i', 'g-ring'));
    else node.textContent = FLEET.stateGlyph(state);

    if (!options.static) {
      node.addEventListener('mouseenter', (e) => showTooltip(a, e));
      node.addEventListener('mousemove', (e) => moveTooltip(e));
      node.addEventListener('mouseleave', hideTooltip);
      node.addEventListener('click', () => select(a.id));
    }
    return node;
  }

  function sampleGlyph(state) {
    const node = el('span', 'glyph');
    node.dataset.state = state;
    node.dataset.live = 'alive';
    node.dataset.motion = 'still';
    if (state === 'working') node.append(el('i', 'g-ring'));
    else node.textContent = FLEET.stateGlyph(state);
    return node;
  }

  // ---- top bar ---------------------------------------------------------------

  function renderDials() {
    const c = counts();
    const spec = [
      { label: 'Needs you', value: c.needsYou, tone: 'attention', live: c.needsYou > 0 },
      { label: 'Working', value: c.working, tone: 'plain', live: false },
      { label: 'To review', value: c.review, tone: 'review', live: false },
      { label: 'Done', value: c.done, tone: 'quiet', live: false },
    ];
    dom.dials.replaceChildren(
      ...spec.map((s) => {
        const d = el('div', 'dial');
        d.dataset.tone = s.tone;
        d.dataset.live = String(s.live);
        d.append(el('div', 'dial-value', String(s.value)), el('div', 'eyebrow dial-label', s.label));
        return d;
      })
    );
  }

  function renderAccounting() {
    if (query) {
      const hits = FLEET.byWorktree.filter(matchesQuery).length;
      dom.accounting.textContent =
        '⌕ ' + hits + ' of ' + FLEET.byWorktree.length + ' worktrees match';
      return;
    }
    dom.accounting.textContent =
      FLEET.counts.total +
      ' of ' +
      FLEET.counts.fleetTotal +
      ' agents · ' +
      FLEET.byWorktree.length +
      ' of ' +
      FLEET.counts.fleetWorktrees +
      ' worktrees';
  }

  // ---- containment map -------------------------------------------------------

  function renderBands() {
    dom.bands.replaceChildren(
      ...FLEET.projects.map((project) => {
        const worst = worstOf(project.agents);
        const band = el('section', 'band');
        band.style.setProperty('--band-tint', 'var(' + FLEET.stateColorVar(worst) + ')');
        band.dataset.grow = String(project.name === 'orca');
        band.dataset.annunciate = String(project.agents.some(isUnacked));

        const head = el('div', 'band-head');
        head.append(
          el(
            'span',
            'eyebrow',
            project.name.toUpperCase() +
              ' · ' +
              project.worktrees.length +
              ' worktrees · ' +
              project.agents.length +
              ' agents'
          )
        );
        const flag = el('span', 'band-worst');
        flag.append(sampleGlyph(worst), el('span', null, 'worst: ' + STATE_LABEL[worst]));
        head.append(flag);

        const cells = el('div', 'cells');
        if (project.worktrees.length === 0) {
          cells.append(el('p', 'rail-empty', 'No worktrees in this project.'));
        } else {
          // FLEET.byWorktree order, never re-sorted by state — a cell keeps its slot so the
          // operator can learn the map's geography.
          for (const wt of project.worktrees) cells.append(cell(wt));
        }
        cells.addEventListener('scroll', drawLineage, { passive: true });
        band.append(head, cells);
        return band;
      })
    );
  }

  function worstOf(list) {
    let best = 'done';
    for (const a of list) {
      const s = effState(a);
      if (FLEET.severityRank(s) < FLEET.severityRank(best)) best = s;
    }
    return best;
  }

  function cell(wt) {
    const node = el('div', 'cell');
    node.dataset.worktree = wt.project + '/' + wt.worktree;
    const head = el('div', 'cell-head');
    head.append(el('span', 'cell-name', wt.worktree));
    if (wt.unread) head.append(el('span', 'cell-unread'));
    head.append(el('span', 'cell-count', String(wt.agents.length)));
    const glyphs = el('div', 'cell-glyphs');
    for (const a of wt.agents) glyphs.append(glyph(a));
    node.append(head, glyphs);
    return node;
  }

  function matchesQuery(wt) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (wt.worktree.toLowerCase().includes(q) || wt.project.toLowerCase().includes(q)) return true;
    return wt.agents.some(
      (a) =>
        a.shortName.toLowerCase().includes(q) ||
        (a.detail || '').toLowerCase().includes(q) ||
        effState(a).includes(q)
    );
  }

  function applySearch() {
    let hits = 0;
    for (const wt of FLEET.byWorktree) {
      const node = dom.bands.querySelector(
        '.cell[data-worktree="' + cssEscape(wt.project + '/' + wt.worktree) + '"]'
      );
      if (!node) continue;
      const hit = matchesQuery(wt);
      if (hit) hits++;
      node.classList.toggle('is-dimmed', Boolean(query) && !hit);
      node.classList.toggle('is-hit', Boolean(query) && hit);
    }
    const blank = Boolean(query) && hits === 0;
    dom.mapEmpty.hidden = !blank;
    if (blank) dom.mapEmpty.textContent = 'No worktree, agent or state matches “' + query + '”.';
    renderAccounting();
  }

  const cssEscape = (value) => value.replace(/["\\]/g, '\\$&');

  // ---- lineage overlay -------------------------------------------------------

  function mapGlyph(id) {
    return dom.bands.querySelector('.glyph[data-agent="' + cssEscape(id) + '"]');
  }

  function drawLineage() {
    dom.lineage.replaceChildren();
    for (const node of dom.bands.querySelectorAll('.glyph.is-linked')) {
      node.classList.remove('is-linked');
    }
    if (!selectedId) return;
    const selected = byId.get(selectedId);
    if (!selected) return;

    const box = dom.map.getBoundingClientRect();
    dom.lineage.setAttribute('width', String(box.width));
    dom.lineage.setAttribute('height', String(box.height));
    dom.lineage.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);

    const from = center(selectedId, box);
    if (!from) return;
    const kin = [];
    if (selected.parent && byId.has(selected.parent)) kin.push(byId.get(selected.parent));
    kin.push(...(childrenOf.get(selectedId) || []));

    for (const relative of kin) {
      const to = center(relative.id, box);
      if (!to) continue; // scrolled out of its band — draw nothing rather than a lying edge
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', sweep(from, to));
      dom.lineage.append(path, dot(to));
      const node = mapGlyph(relative.id);
      if (node) node.classList.add('is-linked');
    }
    if (dom.lineage.childNodes.length) dom.lineage.append(dot(from));
  }

  /* A lateral sweep rather than a straight run, so the edge reads as a relationship laid over
     the grid instead of a border between cells. */
  function sweep(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const sign = dx >= 0 ? 1 : -1;
    const lateral = Math.abs(dx) < 30 ? 46 : Math.max(30, Math.min(110, Math.abs(dx) / 2));
    const c1 = { x: from.x + sign * lateral, y: from.y + dy * 0.12 };
    const c2 = { x: to.x - sign * lateral, y: to.y - dy * 0.12 };
    return (
      'M ' + from.x + ' ' + from.y +
      ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + to.x + ' ' + to.y
    );
  }

  function dot(point) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(point.x));
    circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', '1.6');
    return circle;
  }

  /* Returns null when the glyph is clipped by its band's own scroller: getBoundingClientRect
     still reports a laid-out position for a scrolled-away cell, and an edge drawn to one would
     point at nothing. */
  function center(id, box) {
    const node = mapGlyph(id);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const clip = node.closest('.cells');
    if (clip) {
      const c = clip.getBoundingClientRect();
      if (r.bottom < c.top + 2 || r.top > c.bottom - 2) return null;
    }
    const point = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    if (point.y < 0 || point.y > box.height || point.x < 0 || point.x > box.width) return null;
    return point;
  }

  // ---- tooltip ---------------------------------------------------------------

  function tooltipLine(label, value) {
    const row = el('div', 'tooltip-line');
    row.append(el('span', 'eyebrow', label), el('span', null, value));
    return row;
  }

  function showTooltip(a, event) {
    const state = effState(a);
    dom.tooltip.replaceChildren(
      el('div', 'tooltip-name', a.shortName),
      tooltipLine('state', STATE_LABEL[state] + ' · ' + liveState(a)),
      tooltipLine('where', a.displayProject + ' / ' + a.worktree),
      tooltipLine('age', 'started ' + FLEET.ageLabel(a.startedAgo) + ' ago'),
      tooltipLine('run', FLEET.ageLabel(a.durationMs) + (a.bucket === 'done' || a.bucket === 'review' ? ' (final)' : ' so far')),
      tooltipLine(a.bucket === 'working' || a.bucket === 'needsYou' ? 'tool' : 'last', a.detail || '—')
    );
    if (peek && a.id === selectedId) {
      dom.tooltip.append(el('div', 'tooltip-tail', FLEET.fakeTail(a).slice(-4).join('\n')));
    }
    dom.tooltip.hidden = false;
    moveTooltip(event);
  }

  function moveTooltip(event) {
    if (dom.tooltip.hidden) return;
    const pad = 14;
    const r = dom.tooltip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = event.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = event.clientY - r.height - pad;
    dom.tooltip.style.left = Math.max(8, x) + 'px';
    dom.tooltip.style.top = Math.max(8, y) + 'px';
  }

  function hideTooltip() {
    if (peek) return;
    dom.tooltip.hidden = true;
  }

  // ---- intervention rail -----------------------------------------------------

  function railHead(label, count, tail, cycle) {
    const head = el('div', 'rail-head');
    let text = label + ' · ' + count;
    if (tail) text += ' · ' + tail;
    head.append(el('span', 'eyebrow', text));
    if (cycle) head.append(cycle);
    return head;
  }

  function cyclePill(label, key, handler, exhausted) {
    const pill = el('button', 'cycle');
    pill.type = 'button';
    pill.dataset.exhausted = String(exhausted);
    pill.append(el('kbd', null, key), el('span', null, label));
    if (!exhausted) pill.addEventListener('click', handler);
    return pill;
  }

  function nameRow(a, extras) {
    const row = el('div', 'item-head');
    row.append(glyph(a, { static: true }), el('span', 'item-name', a.shortName));
    row.append(el('span', 'item-where', a.worktree));
    if (extras) for (const node of extras) row.append(node);
    return row;
  }

  function linkRow(row, a) {
    row.dataset.agent = a.id;
    row.addEventListener('mouseenter', () => {
      const node = mapGlyph(a.id);
      if (node) node.classList.add('is-linked');
    });
    row.addEventListener('mouseleave', drawLineage);
    return row;
  }

  function renderRail() {
    const open = openDecisions();
    const attention = openList('attention');
    const failed = openList('failed');
    const needsYou = counts().needsYou;
    const nodes = [];

    nodes.push(
      railHead(
        'Needs you',
        needsYou,
        null,
        cyclePill('next', '⏎', () => cycleNeedsYou(), needsYou === 0)
      )
    );

    if (needsYou === 0) {
      nodes.push(el('p', 'rail-empty', 'Fleet clear — nothing is waiting on you.'));
    }

    if (open.length === 0 && needsYou > 0) {
      nodes.push(el('p', 'rail-empty', 'No permission requests pending.'));
    }
    for (const entry of open) nodes.push(decisionCard(entry, entry.decision.key === expandedDecision));

    if (attention.length === 0 && needsYou > 0) {
      nodes.push(el('p', 'rail-empty', 'No questions waiting.'));
    }
    attention.forEach((a, i) => nodes.push(attentionCard(a, i === 0)));

    if (failed.length === 0 && needsYou > 0) {
      nodes.push(el('p', 'rail-empty', 'No failures.'));
    }
    failed.forEach((a, i) => nodes.push(failureCard(a, i === 0)));

    const review = openList('review');
    nodes.push(
      railHead(
        'To review',
        review.length,
        'seen ≠ reviewed',
        cyclePill('next', 'F', () => cycleReview(), review.length === 0)
      )
    );
    if (review.length === 0) {
      nodes.push(el('p', 'rail-empty', 'Nothing awaiting review.'));
    }
    // Failures and PR-bearing runs are pulled above the fold no matter where they sort.
    const shown = review.filter((a, i) => i < 6 || Boolean(a.pr));
    shown.forEach((a, i) => nodes.push(reviewRow(a, i === 0)));
    const folded = review.length - shown.length;
    if (folded > 0) {
      nodes.push(
        el('p', 'fold', '… ' + folded + ' more below the fold — failures and PRs never fold')
      );
    }

    const cleared = FLEET.agents.filter((a) => resolved.has(a.id)).length;
    if (cleared > 0) {
      const note = el('div', 'resolved');
      note.append(sampleGlyph('working'), el('span', null, cleared + ' cleared this session'));
      nodes.push(note);
    }

    dom.rail.replaceChildren(...nodes);
  }

  function decisionCard(entry, expanded) {
    const d = entry.decision;
    const agents = entry.agents;
    const card = el('article', 'item');
    card.dataset.kind = 'decision';
    card.dataset.motion = 'blink';
    card.dataset.decision = d.key;

    const holdsSelection = agents.some((a) => a.id === selectedId);
    if (holdsSelection) card.classList.add('is-selected');

    const head = el('div', 'item-head');
    head.append(el('span', 'item-title', d.title));
    if (holdsSelection) head.append(el('span', 'chip-selected', 'selected on map'));
    card.append(head);

    if (!expanded) {
      const meta = el('div', 'meta');
      meta.style.marginTop = '4px';
      meta.textContent = agents.length + ' agents · ' + projectSummary(agents) + ' ▸';
      card.append(meta);
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        expandedDecision = d.key;
        render();
      });
      return card;
    }

    card.append(el('code', 'command', d.command));
    card.append(el('div', 'meta', agents.length + ' agents · ' + projectSummary(agents)));

    const rows = el('div', 'microrows');
    for (const a of agents) {
      const row = el('div', 'microrow');
      if (a.id === selectedId) row.classList.add('is-selected');
      row.append(
        glyph(a, { static: true }),
        el('span', 'item-name', a.shortName),
        el('span', 'item-where', a.worktree),
        el('span', 'item-age', FLEET.ageLabel(a.startedAgo))
      );
      row.addEventListener('click', () => select(a.id));
      rows.append(linkRow(row, a));
    }
    card.append(rows);

    const evidence = el('div', 'evidence');
    evidence.innerHTML = commonality(d, agents);
    card.append(evidence);

    const scope = el('div', 'scope');
    scope.append(el('span', 'eyebrow', 'Scope'));
    const segmented = el('div', 'segmented');
    for (const option of SCOPES) {
      const seg = el('button', 'segment', option.label);
      seg.type = 'button';
      seg.setAttribute('aria-pressed', String(scopeByDecision.get(d.key) === option.id));
      seg.addEventListener('click', () => {
        scopeByDecision.set(d.key, option.id);
        render();
      });
      segmented.append(seg);
    }
    scope.append(segmented);
    card.append(scope);

    const scopeId = scopeByDecision.get(d.key);
    const inScope = agentsInScope(agents, scopeId);
    if (inScope.length < agents.length) {
      card.append(
        el(
          'div',
          'meta',
          'Applies to ' +
            inScope[0].displayProject +
            ' only — ' +
            (agents.length - inScope.length) +
            ' agents in ' +
            projectSummary(agents.filter((a) => !inScope.includes(a))) +
            ' stay blocked.'
        )
      );
    }

    const actions = el('div', 'actions');
    const allow = el('button', 'btn btn-primary', 'Allow');
    allow.type = 'button';
    allow.addEventListener('click', () => resolve(inScope));
    const deny = el('button', 'btn btn-ghost', 'Deny');
    deny.type = 'button';
    deny.addEventListener('click', () => resolve(inScope));
    actions.append(allow, deny);
    actions.append(el('span', 'meta', 'unblocks ' + inScope.length + ' of ' + agents.length));
    card.append(actions);
    return card;
  }

  function agentsInScope(agents, scopeId) {
    if (scopeId !== 'project') return agents.slice();
    const anchor = agents.find((a) => a.id === selectedId) || agents[0];
    return agents.filter((a) => a.displayProject === anchor.displayProject);
  }

  function projectSummary(agents) {
    const projects = [...new Set(agents.map((a) => a.displayProject))];
    return projects.length <= 2 ? projects.join(' + ') : projects.length + ' projects';
  }

  /* What the blocked agents actually have in common — read off the set, not asserted. */
  function commonality(d, agents) {
    const bits = ['same command <b>' + escapeHtml(d.command) + '</b>'];
    const types = [...new Set(agents.map((a) => a.agentType))];
    if (types.length === 1) bits.push('all <b>' + escapeHtml(types[0]) + '</b>');
    const projects = [...new Set(agents.map((a) => a.displayProject))];
    const worktrees = new Set(agents.map((a) => a.worktree)).size;
    bits.push(
      projects.length === 1
        ? worktrees + ' worktrees in <b>' + escapeHtml(projects[0]) + '</b>'
        : worktrees + ' worktrees across <b>' + escapeHtml(projects.join(' + ')) + '</b>'
    );
    if (agents.every((a) => a.alive)) bits.push('all still running');
    return 'all ' + agents.length + ' share: ' + bits.join(' · ');
  }

  const escapeHtml = (value) =>
    value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function attentionCard(a, expanded) {
    const card = el('article', 'item');
    card.dataset.kind = 'attention';
    card.dataset.motion = 'blink';
    if (a.id === selectedId) card.classList.add('is-selected');
    card.append(nameRow(a, [el('span', 'item-age', FLEET.ageLabel(a.startedAgo))]));
    card.append(el('p', 'question', '“' + a.question.text + '”'));

    if (expanded) {
      const options = el('div', 'options');
      a.question.options.forEach((label, i) => {
        const button = el('button', 'option');
        button.type = 'button';
        button.append(el('kbd', null, String(i + 1)), el('span', null, label));
        button.addEventListener('click', () => resolve([a]));
        options.append(button);
      });
      card.append(options);

      const reply = el('div', 'reply');
      const input = el('input');
      input.type = 'text';
      input.placeholder = 'Reply to ' + a.shortName.slice(0, 24) + '…';
      const send = el('button', 'btn', 'Send');
      send.type = 'button';
      send.addEventListener('click', () => resolve([a]));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') resolve([a]);
      });
      reply.append(input, send);
      card.append(reply);
    }
    card.addEventListener('click', () => select(a.id));
    return linkRow(card, a);
  }

  function failureCard(a, expanded) {
    const card = el('article', 'item');
    card.dataset.kind = 'failed';
    card.dataset.motion = 'blink';
    if (a.id === selectedId) card.classList.add('is-selected');
    card.append(nameRow(a, [el('span', 'item-age', FLEET.ageLabel(a.startedAgo))]));
    card.append(el('p', 'failure', a.failure));
    if (expanded) {
      const actions = el('div', 'actions');
      const retry = el('button', 'btn btn-ghost', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => resolve([a]));
      const open = el('button', 'btn btn-ghost', 'Open terminal');
      open.type = 'button';
      open.addEventListener('click', () => select(a.id));
      actions.append(retry, open);
      card.append(actions);
    }
    card.addEventListener('click', () => select(a.id));
    return linkRow(card, a);
  }

  function reviewRow(a, expanded) {
    const card = el('article', 'item');
    card.dataset.kind = 'review';
    card.dataset.motion = 'pulse';
    if (a.id === selectedId) card.classList.add('is-selected');
    const extras = [];
    if (a.pr) extras.push(el('span', 'pr-badge', '#' + a.pr.number));
    extras.push(el('span', 'item-age', FLEET.ageLabel(a.durationMs)));
    card.append(nameRow(a, extras));
    if (expanded) {
      const actions = el('div', 'actions');
      const diff = el('button', 'btn', 'Review diff');
      diff.type = 'button';
      diff.addEventListener('click', () => select(a.id));
      const mark = el('button', 'btn btn-ghost', 'Mark reviewed');
      mark.type = 'button';
      mark.addEventListener('click', () => resolve([a]));
      actions.append(diff, mark);
      card.append(actions);
    }
    card.addEventListener('click', () => select(a.id));
    return linkRow(card, a);
  }

  // ---- actions ---------------------------------------------------------------

  function resolve(agents) {
    for (const a of agents) resolved.add(a.id);
    if (selectedId && resolved.has(selectedId)) selectedId = null;
    const stillOpen = openDecisions();
    if (!stillOpen.some((d) => d.decision.key === expandedDecision)) {
      expandedDecision = stillOpen.length ? stillOpen[0].decision.key : null;
    }
    touch();
    render();
  }

  function select(id) {
    selectedId = id;
    peek = false;
    dom.tooltip.hidden = true;
    const agent = byId.get(id);
    if (agent && agent.decisionKey && !resolved.has(id)) expandedDecision = agent.decisionKey;
    touch();
    render();
    for (const node of dom.bands.querySelectorAll('.glyph.is-selected')) {
      node.classList.remove('is-selected');
    }
    const node = mapGlyph(id);
    if (node) node.classList.add('is-selected');
    drawLineage();
  }

  function needsYouInMapOrder() {
    const order = [];
    for (const wt of FLEET.byWorktree) for (const a of wt.agents) if (isUnacked(a)) order.push(a);
    return order;
  }

  /* One gesture: move to the next thing that needs you and attach to it. */
  function cycleNeedsYou() {
    const order = needsYouInMapOrder();
    if (order.length === 0) return;
    const at = order.findIndex((a) => a.id === selectedId);
    const next = order[(at + 1) % order.length];
    select(next.id);
    revealInRail(next.id);
  }

  function cycleReview() {
    const order = openList('review');
    if (order.length === 0) return;
    const at = order.findIndex((a) => a.id === selectedId);
    const next = order[(at + 1) % order.length];
    select(next.id);
    revealInRail(next.id);
  }

  function revealInRail(id) {
    const node = dom.rail.querySelector('.item[data-agent="' + cssEscape(id) + '"]')
      || dom.rail.querySelector('.microrow[data-agent="' + cssEscape(id) + '"]');
    if (!node) return;
    node.scrollIntoView({ block: 'nearest' });
    const card = node.closest('.item') || node;
    card.classList.add('is-flash');
    setTimeout(() => card.classList.remove('is-flash'), 700);
  }

  function scrollIntoBand(id) {
    const node = mapGlyph(id);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  // ---- status strip ----------------------------------------------------------

  function renderLegend() {
    dom.legendShape.replaceChildren(
      ...LEGEND_ORDER.map((state) => {
        const item = el('span');
        item.append(sampleGlyph(state), el('span', null, LEGEND_LABEL[state]));
        return item;
      })
    );
    const keys = [
      ['Space', 'peek'],
      ['⏎', 'attach'],
      ['1–3', 'answer'],
      ['F', 'review'],
      [MOD + 'K', 'search'],
    ];
    dom.legendKeys.replaceChildren(
      ...keys.map(([key, label]) => {
        const item = el('span');
        item.append(el('kbd', null, key), el('span', null, label));
        return item;
      })
    );
    dom.searchKbd.textContent = MOD + 'K';
  }

  /* Datadog's rule: a board that repaints under the operator's cursor loses the operator.
     The pause clock is the only wall-clock read in this file — every age is FLEET.now-based. */
  function renderCapture() {
    const stamp = new Date(FLEET.now).toISOString().slice(11, 16);
    const paused = Date.now() - lastInteraction < PAUSE_MS;
    dom.capture.dataset.paused = String(paused);
    dom.capture.textContent =
      'captured ' + stamp + ' UTC · ' + (paused ? 'refresh paused while interacting' : 'refresh armed');
  }

  function touch() {
    lastInteraction = Date.now();
    renderCapture();
  }

  // ---- keyboard --------------------------------------------------------------

  function onKeyDown(event) {
    const focused = document.activeElement || document.body;
    const typing = /^(INPUT|TEXTAREA)$/.test(focused.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      dom.search.focus();
      dom.search.select();
      touch();
      return;
    }
    if (event.key === 'Escape') {
      if (typing) {
        dom.search.value = '';
        query = '';
        dom.search.blur();
        applySearch();
      } else if (peek) {
        peek = false;
        dom.tooltip.hidden = true;
      } else {
        selectedId = null;
        render();
      }
      touch();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      cycleNeedsYou();
    } else if (event.key.toLowerCase() === 'f') {
      cycleReview();
    } else if (event.key === ' ') {
      event.preventDefault();
      togglePeek();
    } else if (['1', '2', '3'].includes(event.key)) {
      const first = openList('attention')[0];
      if (first && Number(event.key) <= first.question.options.length) resolve([first]);
    }
    touch();
  }

  function togglePeek() {
    const agent = selectedId && byId.get(selectedId);
    if (!agent) return;
    peek = !peek;
    if (!peek) {
      dom.tooltip.hidden = true;
      return;
    }
    scrollIntoBand(agent.id);
    const node = mapGlyph(agent.id);
    const r = node ? node.getBoundingClientRect() : { left: 40, bottom: 120 };
    showTooltip(agent, { clientX: r.left, clientY: r.bottom });
  }

  // ---- boot ------------------------------------------------------------------

  function render() {
    const railTop = dom.rail.scrollTop;
    const bandTops = [...dom.bands.querySelectorAll('.cells')].map((node) => node.scrollTop);
    renderDials();
    renderBands();
    renderRail();
    dom.rail.scrollTop = railTop;
    [...dom.bands.querySelectorAll('.cells')].forEach((node, i) => {
      if (bandTops[i] != null) node.scrollTop = bandTops[i];
    });
    if (selectedId) {
      const node = mapGlyph(selectedId);
      if (node) node.classList.add('is-selected');
    }
    applySearch();
    drawLineage();
  }

  dom.search.addEventListener('input', () => {
    query = dom.search.value.trim();
    applySearch();
    touch();
  });
  document.addEventListener('keydown', onKeyDown);
  dom.rail.addEventListener('scroll', touch, { passive: true });
  document.addEventListener('pointerdown', touch);
  window.addEventListener('resize', drawLineage);
  setInterval(renderCapture, 1000);

  renderLegend();
  renderCapture();
  render();

  /* Pre-seeded so the board opens mid-investigation rather than empty: the first coalesced
     decision's agent that also has resolvable lineage — selected on the map, its edge drawn to
     its child worktree, and its decision card ringed in the rail. */
  const seed = (FLEET.decisions[0] ? FLEET.decisions[0].agents : []).find(
    (a) => (childrenOf.get(a.id) || []).length > 0 || (a.parent && byId.has(a.parent))
  );
  if (seed) select(seed.id);
  requestAnimationFrame(drawLineage);
})();
