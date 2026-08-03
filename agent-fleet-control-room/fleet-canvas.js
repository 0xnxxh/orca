/* Fleet Canvas — a revival of the movable concentric dashboard: repos are systems
   (core → worktree orbits → agent nodes) on one infinite pan/zoom surface.
   Placement is a pure function of (project, worktree size, name hash), so the map is
   byte-identical on every load and users can build spatial memory. Zoom is altitude:
   text appears band by band instead of scaling into mush. */
(function () {
  'use strict';

  const F = window.FLEET;
  if (!F) throw new Error('fleet-state-synthesis.js must be loaded first');

  const SVGNS = 'http://www.w3.org/2000/svg';
  const IS_MAC = navigator.userAgent.includes('Mac');

  // Clamp zoom so we never invert the content or lose the fleet context.
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 4;
  // Pixels a mousedown may travel before it becomes a pan instead of a click.
  const DRAG_THRESHOLD_PX = 3;
  const FIT_PAD = 40;
  // System sizes are tuned so fit-all lands near 0.8 on a normal window; the floor
  // only bites on a very short one, where holding the label band beats a silent map.
  const SEED_FLOOR = 0.7;
  const CAPTION_CHARS = 34;
  // Labels counter-scale, so their width in world units peaks at the bottom of the
  // label band; 20 chars is what keeps them from colliding there.
  const WT_LABEL_CHARS = 20;

  // World coordinates are fixed per repo: orca large and center-left, orca-mobile
  // right, automation upper-left. Orbit radii carry the size of each system.
  const SYSTEMS = {
    orca: { cx: 0, cy: 0, core: 26, orbits: [145, 235, 325, 415] },
    'orca-mobile': { cx: 830, cy: 115, core: 20, orbits: [115, 200, 280] },
    automation: { cx: -570, cy: -425, core: 15, orbits: [90, 150] },
  };

  const STATE_LABEL = {
    attention: 'Waiting on your answer',
    permission: 'Waiting on permission',
    failed: 'Failed',
    working: 'Working',
    review: 'Ready to review',
    done: 'Done',
  };

  const el = {
    stage: document.getElementById('stage'),
    canvas: document.getElementById('canvas'),
    world: document.getElementById('world'),
    orbits: document.getElementById('orbits'),
    lineage: document.getElementById('lineage'),
    systems: document.getElementById('systems'),
    chips: document.getElementById('chips'),
    accounting: document.getElementById('accounting'),
    whisper: document.getElementById('whisper'),
    search: document.getElementById('search'),
    empty: document.getElementById('empty'),
    panel: document.getElementById('panel'),
    tip: document.getElementById('tip'),
    fit: document.getElementById('fit'),
    zoomreset: document.getElementById('zoomreset'),
  };

  const byId = new Map(F.agents.map((a) => [a.id, a]));
  const childrenOf = new Map();
  for (const a of F.agents) {
    if (a.parent && byId.has(a.parent)) {
      if (!childrenOf.has(a.parent)) childrenOf.set(a.parent, []);
      childrenOf.get(a.parent).push(a.id);
    }
  }

  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const clock = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const liveness = (a) =>
    a.loopSleeping ? 'loop sleeping' : a.alive ? 'process live' : 'process exited';
  // Same FNV-1a the synthesis uses, projected to [0,1) for angles and phases.
  const rnd = (key) => (F.hash(key) % 100000) / 100000;

  // ---- layout ----------------------------------------------------------------

  // Node size restates the original's duration idea: log scale, clamped at 30s and
  // 24h so a six-day loop doesn't flatten everything else.
  const LOG_LO = Math.log(30 * 1000);
  const LOG_HI = Math.log(24 * 3600 * 1000);
  function nodeRadius(a) {
    const t = (Math.log(Math.max(a.durationMs, 1)) - LOG_LO) / (LOG_HI - LOG_LO);
    return 7 + 4 * Math.max(0, Math.min(1, t));
  }

  // Worktrees per orbit, proportional to circumference (largest remainder), so the
  // outer rings — which have the arc length for it — take the crowded ones.
  function ringCapacities(total, orbits) {
    const sum = orbits.reduce((s, r) => s + r, 0);
    const raw = orbits.map((r) => (total * r) / sum);
    const caps = raw.map((v) => Math.floor(v));
    let left = total - caps.reduce((s, c) => s + c, 0);
    const order = caps.map((_, i) => i).sort((a, b) => raw[b] - caps[b] - (raw[a] - caps[a]));
    for (let i = 0; left > 0; i++, left--) caps[order[i % caps.length]]++;
    return caps;
  }

  // A worktree's agents pack into one tight cluster: a single node sits dead centre,
  // 2–7 form a ring, 8+ keep one in the middle. Spacing beats the largest node.
  function packCluster(n, phase) {
    if (n === 1) return [{ x: 0, y: 0 }];
    const outer = n <= 7 ? n : n - 1;
    const radius = 14 + outer * 1.75;
    const pts = n > 7 ? [{ x: 0, y: 0 }] : [];
    for (let i = 0; i < outer; i++) {
      const th = phase + (i * Math.PI * 2) / outer;
      pts.push({ x: radius * Math.cos(th), y: radius * Math.sin(th) });
    }
    return pts;
  }

  const systems = [];
  const posOf = new Map();
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  function grow(x, y, pad) {
    bounds.minX = Math.min(bounds.minX, x - pad);
    bounds.minY = Math.min(bounds.minY, y - pad);
    bounds.maxX = Math.max(bounds.maxX, x + pad);
    bounds.maxY = Math.max(bounds.maxY, y + pad);
  }

  for (const p of F.projects) {
    const cfg = SYSTEMS[p.name];
    if (!cfg) continue;
    // Stable sort on a list already alphabetised by the synthesis: equal-size
    // worktrees stay in name order, so ring membership never wobbles.
    const wts = p.worktrees.slice().sort((a, b) => a.agents.length - b.agents.length);
    const caps = ringCapacities(wts.length, cfg.orbits);
    const sys = { name: p.name, project: p, cx: cfg.cx, cy: cfg.cy, core: cfg.core, orbits: cfg.orbits, clusters: [] };
    let idx = 0;

    cfg.orbits.forEach((radius, ring) => {
      const k = caps[ring];
      if (!k) return;
      const slot = (Math.PI * 2) / k;
      const phase = rnd(p.name + '#orbit' + ring) * Math.PI * 2;
      for (let j = 0; j < k; j++, idx++) {
        const wt = wts[idx];
        const key = p.name + '/' + wt.worktree;
        // Even slots keep clusters from colliding; hash jitter inside half a slot
        // keeps the ring from reading as a clock face.
        const th = phase + j * slot + (rnd(key) - 0.5) * slot * 0.5;
        const cx = cfg.cx + radius * Math.cos(th);
        const cy = cfg.cy + radius * Math.sin(th);
        const pts = packCluster(wt.agents.length, rnd(key + ':pack') * Math.PI * 2);
        let extent = 0;
        const nodes = wt.agents.map((a, i) => {
          const r = nodeRadius(a);
          const node = { a, x: cx + pts[i].x, y: cy + pts[i].y, r };
          posOf.set(a.id, { x: node.x, y: node.y });
          extent = Math.max(extent, Math.hypot(pts[i].x, pts[i].y) + r);
          return node;
        });
        sys.clusters.push({ wt, key, x: cx, y: cy, extent, nodes });
        grow(cx, cy, extent + 26);
      }
    });

    grow(cfg.cx, cfg.cy, cfg.core + 30);
    systems.push(sys);
  }

  // Greedy label thinning, the way map renderers do it: walk the worktrees worst
  // state first and drop any label that would collide with one already placed.
  // Measured at the bottom of the label band, where counter-scaled text is widest
  // in world units — by the near band nothing collides, so nothing is thinned.
  (function thinLabels() {
    const BAND_FLOOR = 0.7;
    const CHAR_W = 5.6;
    const LINE_H = 13;
    const placed = [];
    const cands = [];
    for (const sys of systems) {
      for (const cl of sys.clusters) if (cl.wt.worstState !== 'done') cands.push(cl);
    }
    cands.sort(
      (a, b) =>
        F.severityRank(a.wt.worstState) - F.severityRank(b.wt.worstState) ||
        a.key.localeCompare(b.key),
    );
    for (const cl of cands) {
      const w = (Math.min(cl.wt.worktree.length, WT_LABEL_CHARS) * CHAR_W) / BAND_FLOOR;
      const h = LINE_H / BAND_FLOOR;
      const y = cl.y + cl.extent + 12;
      const box = { x0: cl.x - w / 2, x1: cl.x + w / 2, y0: y - h, y1: y };
      if (placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) {
        cl.crowded = true;
      } else {
        placed.push(box);
      }
    }
  })();

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
          '<span class="chip' + (x.loud ? ' is-loud' : '') + '" style="--hue:' + x.hue + '">' +
          '<i class="dot"></i><span class="n">' + x.n + '</span>' +
          '<span class="lbl">' + x.lbl + '</span></span>',
      )
      .join('<span class="sep">·</span>');

    el.search.placeholder = 'Filter… ' + (IS_MAC ? '⌘K' : 'Ctrl+K');
    el.accounting.textContent =
      c.total + ' / ' + c.fleetTotal + ' agents · ' +
      F.byWorktree.length + ' / ' + c.fleetWorktrees + ' worktrees';

    const keys = [
      ['var(--state-attention)', 'amber = needs you'],
      ['var(--state-working)', 'gold = working'],
      ['var(--state-done)', 'green = review'],
      ['var(--state-idle)', 'dark = done'],
    ];
    el.whisper.innerHTML =
      keys
        .map((k) => '<span class="key"><i class="dot" style="--hue:' + k[0] + '"></i>' + k[1] + '</span>')
        .join('<span class="sep">·</span>') +
      '<span class="sep">·</span><span>scroll to zoom · drag to pan</span>';
  }

  // ---- canvas ----------------------------------------------------------------

  const nodeOf = new Map();

  function svg(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function captionFor(a) {
    if (a.state === 'attention') return clip(a.question.text, CAPTION_CHARS);
    if (a.state === 'permission') {
      const d = F.decisions.find((x) => x.key === a.decisionKey);
      return d ? clip('$ ' + d.command, CAPTION_CHARS) : '';
    }
    if (a.state === 'failed') return clip(a.failure, CAPTION_CHARS);
    return '';
  }

  function renderNode(n) {
    const a = n.a;
    const g = svg('g', {
      class: 'node' + (a.alive ? '' : ' is-dead') + (a.loopSleeping ? ' is-sleeping' : ''),
      transform: 'translate(' + n.x.toFixed(2) + ',' + n.y.toFixed(2) + ')',
      'data-agent': a.id,
      'data-state': a.state,
      tabindex: '0',
      role: 'button',
      'aria-label':
        a.shortName + ' — ' + STATE_LABEL[a.state] + ', ' + a.displayProject + '/' + a.worktree,
    });
    g.appendChild(svg('circle', { class: 'n-sel', r: (n.r + 3.5).toFixed(2) }));
    g.appendChild(svg('circle', { class: 'n-core', r: n.r.toFixed(2) }));

    if (a.state === 'working') {
      const sr = n.r + 4;
      const circ = 2 * Math.PI * sr;
      g.appendChild(
        svg('circle', {
          class: 'n-spin',
          r: sr.toFixed(2),
          'stroke-dasharray': (circ * 0.22).toFixed(2) + ' ' + (circ * 0.78).toFixed(2),
        }),
      );
    } else {
      const glyph = svg('text', { class: 'n-glyph' });
      glyph.textContent = F.stateGlyph(a.state);
      g.appendChild(glyph);
    }

    const cap = captionFor(a);
    if (cap) {
      const t = svg('text', { class: 'n-cap', x: (n.r + 7).toFixed(2), y: '3.5' });
      t.textContent = cap;
      g.appendChild(t);
    }

    nodeOf.set(a.id, g);
    return g;
  }

  function renderCanvas() {
    for (const sys of systems) {
      for (const radius of sys.orbits) {
        el.orbits.appendChild(svg('circle', { class: 'orbit', cx: sys.cx, cy: sys.cy, r: radius }));
      }

      const sg = svg('g', { class: 'system' });
      sg.appendChild(svg('circle', { class: 'core', cx: sys.cx, cy: sys.cy, r: sys.core }));
      sg.appendChild(svg('circle', { class: 'core-pip', cx: sys.cx, cy: sys.cy, r: 2.5 }));

      const name = svg('text', { class: 'repo-name', x: sys.cx, y: sys.cy + sys.core + 20 });
      name.textContent = sys.name;
      sg.appendChild(name);

      const sub = svg('text', { class: 'repo-sub', x: sys.cx, y: sys.cy + sys.core + 34 });
      sub.textContent = sys.project.worktrees.length + ' worktrees · ' + sys.project.agents.length + ' agents';
      sg.appendChild(sub);

      for (const cl of sys.clusters) {
        const cg = svg('g', {
          class:
            'cluster' +
            (cl.wt.worstState === 'done' ? ' is-quiet' : '') +
            (cl.crowded ? ' is-crowded' : ''),
          'data-cluster': cl.key,
        });
        for (const n of cl.nodes) cg.appendChild(renderNode(n));

        const lbl = svg('text', {
          class: 'wt-label',
          x: cl.x.toFixed(2),
          y: (cl.y + cl.extent + 12).toFixed(2),
        });
        lbl.textContent = clip(cl.wt.worktree, WT_LABEL_CHARS);
        cg.appendChild(lbl);

        if (cl.wt.unread) {
          cg.appendChild(
            svg('circle', {
              class: 'wt-unread',
              cx: (cl.x + cl.extent + 6).toFixed(2),
              cy: (cl.y - cl.extent * 0.55).toFixed(2),
              r: '1.5',
            }),
          );
        }
        sg.appendChild(cg);
      }
      el.systems.appendChild(sg);
    }
  }

  // ---- transform -------------------------------------------------------------

  // Module-level so pan/zoom survives a remount, exactly as the original did.
  let tf = { x: 0, y: 0, scale: 1 };
  let band = '';

  function applyTransform() {
    el.world.setAttribute(
      'transform',
      'translate(' + tf.x.toFixed(2) + ',' + tf.y.toFixed(2) + ') scale(' + tf.scale.toFixed(4) + ')',
    );
    el.canvas.style.setProperty('--k', String(1 / tf.scale));
    const next = tf.scale < 0.7 ? 'far' : tf.scale < 1.6 ? 'mid' : 'near';
    if (next !== band) {
      band = next;
      el.canvas.dataset.zoom = next;
    }
    el.zoomreset.textContent = Math.round(tf.scale * 100) + '%';
  }

  function fitAll(floor) {
    const r = el.stage.getBoundingClientRect();
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    let s = Math.min((r.width - FIT_PAD * 2) / w, (r.height - FIT_PAD * 2) / h);
    s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    if (floor) s = Math.min(MAX_SCALE, Math.max(s, floor));
    tf = {
      x: r.width / 2 - (bounds.minX + w / 2) * s,
      y: r.height / 2 - (bounds.minY + h / 2) * s,
      scale: s,
    };
    applyTransform();
  }

  function zoomAt(clientX, clientY, factor) {
    const r = el.stage.getBoundingClientRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, tf.scale * factor));
    const actual = next / tf.scale;
    // Keep the point under the cursor stationary in screen space.
    tf = { x: mx - (mx - tf.x) * actual, y: my - (my - tf.y) * actual, scale: next };
    applyTransform();
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
    // Above the node by default; flipped below when the top of the viewport is
    // too close, so the card is never clipped.
    let y = r.top - t.height - 10;
    if (y < 8) y = r.bottom + 10;
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    el.tip.style.left = x + 'px';
    el.tip.style.top = y + 'px';
  }

  function hideTip() {
    el.tip.hidden = true;
  }

  // ---- lineage ---------------------------------------------------------------

  let selectedId = null;

  function edgePath(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Bow perpendicular to the chord so cross-system edges read as an arc rather
    // than a wire drawn straight through the systems between them.
    const bow = Math.min(len * 0.12, 80);
    const cx = (from.x + to.x) / 2 + (-dy / len) * bow;
    const cy = (from.y + to.y) / 2 + (dx / len) * bow;
    return 'M' + from.x.toFixed(1) + ' ' + from.y.toFixed(1) +
      'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ',' + to.x.toFixed(1) + ' ' + to.y.toFixed(1);
  }

  function drawLineage() {
    if (!selectedId) {
      el.lineage.innerHTML = '';
      return;
    }
    const sel = byId.get(selectedId);
    const from = posOf.get(selectedId);
    if (!from) return;
    const kin = (childrenOf.get(selectedId) || []).slice();
    if (sel.parent && byId.has(sel.parent)) kin.unshift(sel.parent);

    let out = '';
    for (const id of kin) {
      const to = posOf.get(id);
      if (!to || id === selectedId) continue;
      out +=
        '<path class="edge" d="' + edgePath(from, to) + '" />' +
        '<circle class="edge-end" cx="' + to.x.toFixed(1) + '" cy="' + to.y.toFixed(1) + '" r="2.5" />';
    }
    el.lineage.innerHTML = out;
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
    let hits = 0;
    for (const sys of systems) {
      for (const cl of sys.clusters) {
        let clusterHit = false;
        for (const n of cl.nodes) {
          const a = n.a;
          const hit =
            !q ||
            a.name.toLowerCase().includes(q) ||
            a.worktree.toLowerCase().includes(q) ||
            a.displayProject.toLowerCase().includes(q) ||
            a.agentType.toLowerCase().includes(q) ||
            a.state.includes(q) ||
            STATE_LABEL[a.state].toLowerCase().includes(q);
          // Matches keep their position; misses only lose opacity.
          nodeOf.get(a.id).classList.toggle('is-dim', Boolean(q) && !hit);
          if (hit) {
            clusterHit = true;
            if (q) hits++;
          }
        }
        nodeOf.get(cl.nodes[0].a.id).parentNode.classList.toggle('is-dim', Boolean(q) && !clusterHit);
      }
    }
    const dead = Boolean(q) && hits === 0;
    el.empty.hidden = !dead;
    if (dead) el.empty.textContent = 'No agents match “' + raw.trim() + '”';
  }

  // ---- wiring ----------------------------------------------------------------

  renderChrome();
  renderCanvas();

  let panStart = null;
  let dragged = false;

  // The viewport tools float over the stage, so their clicks must not read as a
  // pan start or as a click on empty canvas.
  const onChrome = (e) => Boolean(e.target.closest('.viewtools'));

  el.stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || onChrome(e)) return;
    panStart = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y };
    dragged = false;
    el.stage.classList.add('is-panning');
  });

  window.addEventListener('mousemove', (e) => {
    if (!panStart) return;
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    if (!dragged && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
      dragged = true;
      // A tooltip would otherwise hang frozen while the content slides under it.
      hideTip();
    }
    if (!dragged) return;
    tf.x = panStart.tx + dx;
    tf.y = panStart.ty + dy;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    panStart = null;
    el.stage.classList.remove('is-panning');
  });

  // Native listeners with { passive: false }: the page must not scroll or
  // page-zoom while the canvas is being manipulated.
  el.stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // Chromium delivers a trackpad pinch as a ctrlKey wheel with small deltas;
      // both paths zoom here, pinch at higher sensitivity.
      const sensitivity = e.ctrlKey ? 0.02 : 0.0015;
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * sensitivity));
    },
    { passive: false },
  );

  // macOS Chromium also emits WebKit-legacy gesture events for trackpad pinch,
  // and in some windows that is the only path that fires.
  let gScale = 1;
  el.stage.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gScale = 1;
  });
  el.stage.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const delta = e.scale / gScale;
    gScale = e.scale;
    if (Number.isFinite(delta) && delta > 0) zoomAt(e.clientX, e.clientY, delta);
  });
  el.stage.addEventListener('gestureend', (e) => e.preventDefault());

  el.stage.addEventListener('click', (e) => {
    // mouseup runs before click, so a finished pan is already flagged here.
    if (dragged || onChrome(e)) return;
    const node = e.target.closest('.node');
    if (!node) {
      if (selectedId) select(null);
      return;
    }
    select(node.dataset.agent === selectedId ? null : node.dataset.agent);
  });

  el.stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.node')) return;
    fitAll();
  });

  el.stage.addEventListener('mouseover', (e) => {
    if (dragged || panStart) return;
    const node = e.target.closest('.node');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.stage.addEventListener('mouseout', (e) => {
    if (e.target.closest('.node')) hideTip();
  });
  el.stage.addEventListener('focusin', (e) => {
    const node = e.target.closest('.node');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.stage.addEventListener('focusout', hideTip);
  el.stage.addEventListener('keydown', (e) => {
    const node = e.target.closest('.node');
    if (node && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      select(node.dataset.agent === selectedId ? null : node.dataset.agent);
    }
  });

  el.fit.addEventListener('click', () => fitAll());
  el.zoomreset.addEventListener('click', () => {
    const r = el.stage.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / tf.scale);
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

  // Fit is a viewport operation, not a layout one: resizing re-frames the same
  // world only while the user has not taken over the viewport themselves.
  let userMoved = false;
  el.stage.addEventListener('wheel', () => (userMoved = true), { passive: true });
  el.stage.addEventListener('mousedown', () => (userMoved = true));
  window.addEventListener('resize', () => {
    if (!userMoved) fitAll(SEED_FLOOR);
  });

  // Pre-seed: fit the whole fleet inside the label band, then open the one
  // needs-you agent whose parent lives in another repo system — the first paint
  // carries a cross-system lineage edge and the numbered reply panel.
  fitAll(SEED_FLOOR);
  const seed =
    F.agents.find(
      (a) =>
        a.state === 'attention' &&
        a.parent &&
        byId.has(a.parent) &&
        byId.get(a.parent).displayProject !== a.displayProject,
    ) ||
    F.agents.find((a) => a.state === 'attention' && a.parent && byId.has(a.parent)) ||
    F.agents.find((a) => a.state === 'attention' && a.pinned) ||
    F.buckets.needsYou[0];
  select(seed ? seed.id : null);
  userMoved = false;
})();
