/* Fleet Tiles — one semantic-zoom canvas for the whole fleet.
   Every agent is the same rounded tile in world units; altitude decides what is
   INSIDE it: a colour chip far out, a card at cruising height, a live terminal up
   close. Repos are islands you can rearrange; agents are not draggable, because
   the furniture is yours and the people are not.
   Placement is a pure function of the fleet data, so the map is byte-identical on
   every load. Ages come from FLEET.now; timers pace typing only, never content. */
(function () {
  'use strict';

  const F = window.FLEET;
  if (!F) throw new Error('fleet-state-synthesis.js must be loaded first');

  const IS_MAC = navigator.userAgent.includes('Mac');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- world geometry (world units == CSS px before #world's transform) ------

  const TILE_W = 132;
  const TILE_H = 80;
  const TILE_GAP = 10;
  const GROUP_GAP = 16;
  const ROW_GAP = 16;
  const LABEL_H = 20;
  const PAD_X = 26;
  const PAD_TOP = 64; // island header lane
  const PAD_BOTTOM = 26;
  const ISLAND_HGAP = 90;
  const ISLAND_VGAP = 50;
  // Shelf widths chosen so the three islands fit-all at ~0.62 on a 1600×1000
  // window — inside the mid band, where the cards are the readable layer.
  const ISLAND_MAX_W = { orca: 1590, 'orca-mobile': 570, automation: 720 };
  const ORCA_CENTRE = { x: 1700, y: 1100 };

  // ---- viewport --------------------------------------------------------------

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 3;
  const BAND_FAR = 0.55; // below: colour chips only
  const BAND_NEAR = 1.4; // at or above: live terminals
  const FIT_PAD = 40;
  // Fit never drops the window into the far band, where the map goes wordless.
  const FIT_FLOOR = 0.58;
  const DRAG_THRESHOLD_PX = 3;
  const FOCUS_SCALE = 1.5;

  const TERM_LINES = 5;
  const PANEL_LINES = 8;
  const MAX_STREAM = 14;
  const LAYOUT_KEY = 'fleet-tiles-layout-v1';

  const STATE_LABEL = {
    attention: 'Waiting on your answer',
    permission: 'Waiting on permission',
    failed: 'Failed',
    working: 'Working',
    review: 'Ready to review',
    done: 'Done',
  };
  // codex and claude both start with c, so the chip carries two letters.
  const TYPE_CHIP = { codex: 'cx', claude: 'cl', grok: 'gk' };

  const el = {
    stage: document.getElementById('stage'),
    world: document.getElementById('world'),
    lineage: document.getElementById('lineage'),
    chips: document.getElementById('chips'),
    accounting: document.getElementById('accounting'),
    whisper: document.getElementById('whisper'),
    search: document.getElementById('search'),
    empty: document.getElementById('empty'),
    panel: document.getElementById('panel'),
    tip: document.getElementById('tip'),
    fit: document.getElementById('fit'),
    reset: document.getElementById('resetlayout'),
    minimap: document.getElementById('minimap'),
    mmsvg: document.getElementById('mmsvg'),
    mmislands: document.getElementById('mmislands'),
    mmdots: document.getElementById('mmdots'),
    mmview: document.getElementById('mmview'),
  };

  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const liveness = (a) =>
    a.loopSleeping ? 'loop sleeping' : a.alive ? 'process live' : 'process exited';

  const byId = new Map(F.agents.map((a) => [a.id, a]));
  const childrenOf = new Map();
  for (const a of F.agents) {
    if (a.parent && byId.has(a.parent)) {
      if (!childrenOf.has(a.parent)) childrenOf.set(a.parent, []);
      childrenOf.get(a.parent).push(a.id);
    }
  }

  // ---- persisted furniture deltas -------------------------------------------

  function loadLayout() {
    try {
      return JSON.parse(window.localStorage.getItem(LAYOUT_KEY) || '{}') || {};
    } catch (err) {
      return {};
    }
  }
  function saveLayout() {
    try {
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(deltas));
    } catch (err) {
      /* private mode / file:// with storage disabled — the layout is just not sticky */
    }
  }
  const deltas = loadLayout();
  const ZERO = { dx: 0, dy: 0 };
  const deltaOf = (key) => deltas[key] || ZERO;

  // ---- layout ----------------------------------------------------------------

  function groupSize(n) {
    const cols = Math.min(2, n);
    const rows = Math.ceil(n / cols);
    return {
      cols,
      rows,
      w: cols * TILE_W + (cols - 1) * TILE_GAP,
      h: rows * TILE_H + (rows - 1) * TILE_GAP + LABEL_H,
    };
  }

  const islands = [];
  const groups = [];
  const tiles = [];
  const islandByName = new Map();
  const groupByKey = new Map();
  const tileOf = new Map();

  for (const p of F.projects) {
    const maxW = ISLAND_MAX_W[p.name] || 860;
    // Tall groups lead so the shelf rows pack without ragged vertical slack; ties
    // keep FLEET.byWorktree order, which is alphabetical and therefore stable.
    const order = p.worktrees
      .map((g, i) => [g, i])
      .sort(
        (a, b) => groupSize(b[0].agents.length).h - groupSize(a[0].agents.length).h || a[1] - b[1],
      )
      .map((x) => x[0]);

    const isl = { name: p.name, project: p, worstState: p.worstState, groups: [] };
    let x = 0;
    let y = 0;
    let rowH = 0;
    let contentW = 0;

    for (const wt of order) {
      const s = groupSize(wt.agents.length);
      if (x > 0 && x + s.w > maxW) {
        x = 0;
        y += rowH + ROW_GAP;
        rowH = 0;
      }
      const g = {
        key: p.name + '/' + wt.worktree,
        wt,
        island: isl,
        baseX: x,
        baseY: y,
        w: s.w,
        h: s.h,
        tiles: [],
      };
      wt.agents.forEach((a, i) => {
        const t = {
          a,
          group: g,
          dx: (i % s.cols) * (TILE_W + TILE_GAP),
          dy: LABEL_H + Math.floor(i / s.cols) * (TILE_H + TILE_GAP),
        };
        g.tiles.push(t);
        tiles.push(t);
        tileOf.set(a.id, t);
      });
      isl.groups.push(g);
      groups.push(g);
      groupByKey.set(g.key, g);
      x += s.w + GROUP_GAP;
      contentW = Math.max(contentW, x - GROUP_GAP);
      rowH = Math.max(rowH, s.h);
    }

    // A label may overhang its own group — a one-agent group is narrower than its
    // worktree name — but never far enough to collide with the next label in the
    // row, so it ellipsises at the neighbour instead of overprinting it.
    isl.groups.forEach((g, i) => {
      const next = isl.groups[i + 1];
      const edge = next && next.baseY === g.baseY ? next.baseX : contentW + GROUP_GAP;
      g.labelW = edge - g.baseX - 6;
    });

    isl.w = contentW + 2 * PAD_X;
    isl.h = y + rowH + PAD_TOP + PAD_BOTTOM;
    islands.push(isl);
    islandByName.set(isl.name, isl);
  }

  // orca is the anchor; mobile takes the right flank, automation the upper-left.
  (function placeIslands() {
    const anchor =
      islandByName.get('orca') || islands.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!anchor) return;
    anchor.baseX = ORCA_CENTRE.x - anchor.w / 2;
    anchor.baseY = ORCA_CENTRE.y - anchor.h / 2;
    const up = islandByName.get('automation');
    if (up && up !== anchor) {
      up.baseX = anchor.baseX;
      up.baseY = anchor.baseY - ISLAND_VGAP - up.h;
    }
    const right = islandByName.get('orca-mobile');
    if (right && right !== anchor) {
      right.baseX = anchor.baseX + anchor.w + ISLAND_HGAP;
      right.baseY = anchor.baseY + (anchor.h - right.h) / 2;
    }
    let spill = anchor.baseX + anchor.w + ISLAND_HGAP;
    for (const i of islands) {
      if (typeof i.baseX === 'number') continue;
      i.baseX = spill;
      i.baseY = anchor.baseY;
      spill += i.w + ISLAND_HGAP;
    }
  })();

  const islandPos = (i) => {
    const d = deltaOf('island:' + i.name);
    return { x: i.baseX + d.dx, y: i.baseY + d.dy };
  };
  const groupOffset = (g) => {
    const d = deltaOf('wt:' + g.key);
    return { x: PAD_X + g.baseX + d.dx, y: PAD_TOP + g.baseY + d.dy };
  };
  const groupPos = (g) => {
    const ip = islandPos(g.island);
    const go = groupOffset(g);
    return { x: ip.x + go.x, y: ip.y + go.y };
  };
  const tileCentre = (t) => {
    const gp = groupPos(t.group);
    return { x: gp.x + t.dx + TILE_W / 2, y: gp.y + t.dy + TILE_H / 2 };
  };

  function worldBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (x, y, w, h) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };
    for (const i of islands) {
      const p = islandPos(i);
      grow(p.x, p.y, i.w, i.h);
    }
    // A group dragged out of formation still belongs to the fleet's extent.
    for (const g of groups) {
      const p = groupPos(g);
      grow(p.x, p.y, g.w, g.h);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // ---- output streams (deterministic content, jittered pacing) ---------------

  const WORK_LINES = [
    '$ pnpm vitest run src/renderer/src/components/dashboard-popout',
    ' ✓ 18 tests passed (412ms)',
    '$ git add -A',
    '$ git commit -m "fix(dashboard): keep retained rows stable"',
    'Reading src/shared/dashboard-snapshot.ts…',
    'Editing src/renderer/src/components/dashboard/agent-row-lineage.ts',
    '  + carried stateChangedAt through the retained-row path',
    '$ pnpm oxlint src/main/ipc --max-warnings 0',
    ' Found 0 warnings and 0 errors.',
    ' RUN  v3.2.4  ~/orca/{wt}',
    '⏺ {detail}',
    '$ git diff --stat',
    ' 3 files changed, 96 insertions(+), 22 deletions(-)',
    'Searching for "buildDashboardSnapshot" — 14 matches',
    '$ pnpm typecheck',
    ' tsc --noEmit … done in 21.4s',
    'Editing src/main/startup/configure-process.ts',
    '$ gh pr checks --watch',
    ' verify (renderer)   pass   2m14s',
    ' ✓ groups cards by bucket (18ms)',
    '· {detail}',
    '$ git status --porcelain=v2 --branch',
    'Reading docs/reference/git-compatibility.md…',
    'Writing src/renderer/src/components/dashboard-popout/activity-lane-model.ts',
  ];

  const streams = new Map();
  const fill = (line, a) =>
    line.replace('{detail}', a.detail || 'thinking').replace('{wt}', a.worktree);

  function pull(st, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(fill(WORK_LINES[(st.h + st.i * st.stride) % WORK_LINES.length], st.agent));
      st.i += 1;
    }
    return out;
  }

  function trim(st) {
    if (st.lines.length > MAX_STREAM) st.lines = st.lines.slice(-MAX_STREAM);
  }

  function streamOf(id) {
    if (streams.has(id)) return streams.get(id);
    const a = byId.get(id);
    const h = F.hash(a.id);
    const st = {
      agent: a,
      h,
      i: 0,
      stride: 1 + (h % 5),
      lines: F.fakeTail(a).slice(),
      cursor: a.state === 'working' && !a.loopSleeping,
    };
    if (a.loopSleeping) st.lines = st.lines.concat(['', '☾ sleeping · next run 4m']);
    // Stagger the starting depth so the first near-band frame already looks mid-work.
    else if (a.state === 'working') st.lines = st.lines.concat(pull(st, 1 + (h % 8)));
    trim(st);
    streams.set(id, st);
    return st;
  }

  // The newest line ellipsizes rather than hard-clipping, so the cursor — the whole
  // "this one is alive" signal — never falls off the right edge of a small tile.
  function lastLineHtml(st, text) {
    return (
      '<div class="last"><span class="txt">' +
      (esc(text) || '&nbsp;') +
      '</span>' +
      (st.cursor ? '<i class="cur">▍</i>' : '') +
      '</div>'
    );
  }

  function termHtml(st, n) {
    const shown = st.lines.slice(-n);
    return shown
      .map((l, i) =>
        i === shown.length - 1 ? lastLineHtml(st, l) : '<div>' + (esc(l) || '&nbsp;') + '</div>',
      )
      .join('');
  }

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
      c.total +
      ' / ' +
      c.fleetTotal +
      ' agents · ' +
      F.byWorktree.length +
      ' / ' +
      c.fleetWorktrees +
      ' worktrees';

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
      '<span class="sep">·</span><span>scroll to zoom · drag headers to arrange · ' +
      '<kbd>F</kbd> next</span>';
  }

  // ---- world -----------------------------------------------------------------

  function glyphFor(a) {
    if (a.loopSleeping) return '☾';
    return F.stateGlyph(a.state);
  }

  function buildTile(t) {
    const a = t.a;
    const n = document.createElement('div');
    n.className = 'tile' + (a.alive ? '' : ' is-dead');
    n.dataset.agent = a.id;
    n.dataset.state = a.state;
    n.dataset.bucket = a.bucket;
    n.style.left = t.dx + 'px';
    n.style.top = t.dy + 'px';
    n.tabIndex = 0;
    n.setAttribute('role', 'button');
    n.setAttribute(
      'aria-label',
      a.shortName + ' — ' + STATE_LABEL[a.state] + ', ' + a.displayProject + '/' + a.worktree,
    );
    n.innerHTML =
      '<div class="t-card"><span class="t-glyph">' +
      glyphFor(a) +
      '</span><div class="t-name">' +
      esc(a.shortName) +
      '</div><div class="t-foot"><span class="t-type">' +
      (TYPE_CHIP[a.agentType] || a.agentType.slice(0, 2)) +
      '</span><span class="t-age">' +
      F.ageLabel(a.startedAgo) +
      '</span>' +
      (a.pr ? '<span class="t-pr">#' + a.pr.number + '</span>' : '') +
      '</div></div><div class="t-term"></div>';
    t.node = n;
    return n;
  }

  function positionIsland(i) {
    const p = islandPos(i);
    i.node.style.left = p.x + 'px';
    i.node.style.top = p.y + 'px';
  }

  function positionGroup(g) {
    const o = groupOffset(g);
    g.node.style.left = o.x + 'px';
    g.node.style.top = o.y + 'px';
  }

  function buildWorld() {
    for (const i of islands) {
      const n = document.createElement('div');
      n.className = 'island';
      n.dataset.island = i.name;
      n.dataset.worst = i.worstState;
      n.style.width = i.w + 'px';
      n.style.height = i.h + 'px';
      n.innerHTML =
        '<div class="isl-head" title="Drag to move the whole repo">' +
        '<div class="isl-name">' +
        esc(i.name) +
        '</div><div class="isl-sub">' +
        i.project.worktrees.length +
        ' worktrees · ' +
        i.project.agents.length +
        ' agents</div></div>';
      i.node = n;
      positionIsland(i);

      for (const g of i.groups) {
        const gn = document.createElement('div');
        gn.className = 'group' + (g.wt.worstState === 'done' ? ' is-quiet' : '');
        gn.dataset.group = g.key;
        gn.style.width = g.w + 'px';
        gn.style.height = g.h + 'px';
        gn.innerHTML =
          '<div class="wt-label" style="max-width:' + g.labelW + 'px" title="' +
          esc(g.wt.worktree) + ' — drag to move this worktree">' +
          (g.wt.unread ? '<i class="unread"></i>' : '') +
          '<span>' +
          esc(g.wt.worktree) +
          '</span></div>';
        g.node = gn;
        positionGroup(g);
        for (const t of g.tiles) gn.appendChild(buildTile(t));
        n.appendChild(gn);
      }
      el.world.appendChild(n);
    }
  }

  // ---- transform -------------------------------------------------------------

  let tf = { x: 0, y: 0, scale: 1 };
  let band = '';
  let anim = null;

  // Cached: every pan frame writes the transform and then needs the stage size, and
  // reading the rect back in the same frame would force a reflow per mousemove.
  let rectCache = null;
  const stageRect = () => {
    if (!rectCache) rectCache = el.stage.getBoundingClientRect();
    return rectCache;
  };

  function applyTransform() {
    el.world.style.transform =
      'translate(' + tf.x.toFixed(2) + 'px,' + tf.y.toFixed(2) + 'px) scale(' + tf.scale.toFixed(4) + ')';
    const next = tf.scale < BAND_FAR ? 'far' : tf.scale < BAND_NEAR ? 'mid' : 'near';
    if (next !== band) {
      band = next;
      el.stage.dataset.zoom = next;
      if (band === 'near') paintAllTerms();
      syncTyping();
    }
    updateMinimapView();
  }

  function fitAll(floor) {
    const r = stageRect();
    const b = worldBounds();
    let s = Math.min((r.width - FIT_PAD * 2) / b.w, (r.height - FIT_PAD * 2) / b.h);
    s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    if (floor) s = Math.min(MAX_SCALE, Math.max(s, floor));
    tf = {
      x: r.width / 2 - (b.minX + b.w / 2) * s,
      y: r.height / 2 - (b.minY + b.h / 2) * s,
      scale: s,
    };
    applyTransform();
  }

  function zoomAt(clientX, clientY, factor) {
    const r = stageRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, tf.scale * factor));
    const actual = next / tf.scale;
    // Keep the point under the cursor stationary in screen space.
    tf = { x: mx - (mx - tf.x) * actual, y: my - (my - tf.y) * actual, scale: next };
    applyTransform();
  }

  // The panel covers the right of the stage, so "centre" means the centre of what
  // the user can still see.
  function centreTransform(wx, wy, scale) {
    const r = stageRect();
    const inset = el.panel.classList.contains('is-open') ? 370 : 0;
    return { x: (r.width - inset) / 2 - wx * scale, y: r.height / 2 - wy * scale, scale };
  }

  function animateTo(target) {
    if (anim) cancelAnimationFrame(anim);
    const from = { x: tf.x, y: tf.y, scale: tf.scale };
    const t0 = performance.now();
    const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const step = (now) => {
      const u = Math.min(1, (now - t0) / 300);
      const e = REDUCED ? 1 : ease(u);
      tf = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        scale: from.scale + (target.scale - from.scale) * e,
      };
      applyTransform();
      anim = u < 1 && !REDUCED ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }

  // ---- terminals -------------------------------------------------------------

  function paintTile(st) {
    if (band !== 'near') return;
    const t = tileOf.get(st.agent.id);
    const box = t && t.node.querySelector('.t-term');
    if (box) box.innerHTML = termHtml(st, TERM_LINES);
  }

  function paintAllTerms() {
    for (const t of tiles) {
      const box = t.node.querySelector('.t-term');
      if (box) box.innerHTML = termHtml(streamOf(t.a.id), TERM_LINES);
    }
  }

  const timers = new Map();

  function startTyping(st) {
    const handle = {};
    const period = 900 + (st.h % 1700);
    handle.start = window.setTimeout(
      () => {
        const tick = () => {
          st.lines = st.lines.concat(pull(st, 1));
          trim(st);
          paintTile(st);
          if (selectedId === st.agent.id) paintPanelTail(st);
        };
        tick();
        handle.tick = window.setInterval(tick, period);
      },
      Math.random() * 1800,
    );
    timers.set(st.agent.id, handle);
  }

  // Typing is expensive and invisible below the near band, so it only runs for the
  // tiles you can actually read — plus the one open in the panel.
  function syncTyping() {
    const want = new Set();
    if (!REDUCED) {
      if (band === 'near') {
        for (const a of F.buckets.working) if (!a.loopSleeping) want.add(a.id);
      }
      const sel = selectedId ? byId.get(selectedId) : null;
      if (sel && sel.state === 'working' && !sel.loopSleeping) want.add(sel.id);
    }
    for (const [id, h] of timers) {
      if (want.has(id)) continue;
      window.clearTimeout(h.start);
      window.clearInterval(h.tick);
      timers.delete(id);
    }
    for (const id of want) if (!timers.has(id)) startTyping(streamOf(id));
  }

  // ---- minimap ---------------------------------------------------------------

  function renderMinimap() {
    const b = worldBounds();
    el.mmsvg.setAttribute('viewBox', [b.minX, b.minY, b.w, b.h].join(' '));
    el.mmislands.innerHTML = islands
      .map((i) => {
        const p = islandPos(i);
        return (
          '<rect class="mm-island" x="' + p.x.toFixed(0) + '" y="' + p.y.toFixed(0) +
          '" width="' + i.w + '" height="' + i.h + '" rx="20" />'
        );
      })
      .join('');
    // r in world units so the dot lands at ~3px on screen once the viewBox is fitted.
    el.mmdots.innerHTML = tiles
      .map((t) => {
        const c = tileCentre(t);
        return (
          '<circle class="mm-dot" cx="' + c.x.toFixed(0) + '" cy="' + c.y.toFixed(0) +
          '" r="18" style="--hue:var(' + F.stateColorVar(t.a.state) + ')" />'
        );
      })
      .join('');
    updateMinimapView();
  }

  function updateMinimapView() {
    const r = stageRect();
    el.mmview.setAttribute('x', (-tf.x / tf.scale).toFixed(0));
    el.mmview.setAttribute('y', (-tf.y / tf.scale).toFixed(0));
    el.mmview.setAttribute('width', (r.width / tf.scale).toFixed(0));
    el.mmview.setAttribute('height', (r.height / tf.scale).toFixed(0));
  }

  function minimapWorldPoint(e) {
    const m = el.mmsvg.getScreenCTM();
    if (!m) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  }

  // ---- tooltip ---------------------------------------------------------------

  function showTip(node, a) {
    el.tip.style.setProperty('--hue', 'var(' + F.stateColorVar(a.state) + ')');
    el.tip.innerHTML =
      '<div class="t-title">' + esc(a.shortName) + '</div>' +
      '<div class="t-state">' + STATE_LABEL[a.state] +
      '<span class="live">· ' + liveness(a) + '</span></div>' +
      '<div class="t-meta"><span class="mono">' + esc(a.displayProject) + ' / ' + esc(a.worktree) +
      '</span><br />started ' + F.ageLabel(a.startedAgo) + ' ago · ran ' + F.ageLabel(a.durationMs) +
      '<br />' + esc(a.detail || '—') + '</div>';
    el.tip.hidden = false;

    const r = node.getBoundingClientRect();
    const t = el.tip.getBoundingClientRect();
    // Above the tile by default, flipped below when the top of the viewport is
    // too close, so the card is never clipped.
    let y = r.top - t.height - 10;
    if (y < 8) y = r.bottom + 10;
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    el.tip.style.left = x + 'px';
    el.tip.style.top = y + 'px';
  }

  const hideTip = () => {
    el.tip.hidden = true;
  };

  // ---- lineage ---------------------------------------------------------------

  let selectedId = null;

  function edgePath(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Bow perpendicular to the chord, so a cross-island edge reads as an arc rather
    // than a wire drawn straight through everything between the two tiles.
    const bow = Math.min(len * 0.14, 110);
    const cx = (from.x + to.x) / 2 + (-dy / len) * bow;
    const cy = (from.y + to.y) / 2 + (dx / len) * bow;
    return (
      'M' + from.x.toFixed(1) + ' ' + from.y.toFixed(1) +
      'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ',' + to.x.toFixed(1) + ' ' + to.y.toFixed(1)
    );
  }

  function drawLineage() {
    if (!selectedId || !tileOf.has(selectedId)) {
      el.lineage.innerHTML = '';
      return;
    }
    const b = worldBounds();
    el.lineage.setAttribute('viewBox', [b.minX, b.minY, b.w, b.h].join(' '));
    el.lineage.style.left = b.minX + 'px';
    el.lineage.style.top = b.minY + 'px';
    el.lineage.style.width = b.w + 'px';
    el.lineage.style.height = b.h + 'px';

    const sel = byId.get(selectedId);
    const from = tileCentre(tileOf.get(selectedId));
    const kin = (childrenOf.get(selectedId) || []).slice();
    if (sel.parent && byId.has(sel.parent)) kin.unshift(sel.parent);

    let out = '';
    for (const id of kin) {
      if (id === selectedId || !tileOf.has(id)) continue;
      const to = tileCentre(tileOf.get(id));
      out +=
        '<path class="edge" d="' + edgePath(from, to) + '" />' +
        '<circle class="edge-end" cx="' + to.x.toFixed(1) + '" cy="' + to.y.toFixed(1) + '" r="4" />';
    }
    el.lineage.innerHTML = out;
  }

  // ---- selection panel -------------------------------------------------------

  function paintPanelTail(st) {
    const box = el.panel.querySelector('.p-tail');
    if (!box) return;
    const shown = st.lines.slice(-PANEL_LINES);
    const pad = new Array(Math.max(0, PANEL_LINES - shown.length)).fill('').concat(shown);
    let lastIdx = -1;
    pad.forEach((l, i) => {
      if (l.trim()) lastIdx = i;
    });
    box.innerHTML = pad
      .map((l, i) => (i === lastIdx ? lastLineHtml(st, l) : '<div>' + (esc(l) || '&nbsp;') + '</div>'))
      .join('');
  }

  function respondHtml(a) {
    if (a.state === 'attention') {
      const opts = a.question.options
        .map(
          (o, i) =>
            '<button class="opt" type="button"><span class="num">' + (i + 1) + '</span>' + esc(o) + '</button>',
        )
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
      el.stage.style.setProperty('--panel-inset', '0px');
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
      '<div><div class="eyebrow">Tool</div><div class="p-path">' + esc(a.detail || '—') + '</div></div>' +
      '<div class="p-tail"></div>' +
      '</div>' +
      '<div class="p-respond">' + respondHtml(a) + '</div>';

    paintPanelTail(streamOf(a.id));
    el.panel.classList.add('is-open');
    el.panel.setAttribute('aria-hidden', 'false');
    el.stage.style.setProperty('--panel-inset', '370px');
    el.panel.querySelector('.panel-close').addEventListener('click', () => select(null));
  }

  function select(id) {
    const prev = selectedId && tileOf.get(selectedId);
    if (prev) prev.node.classList.remove('is-selected');
    selectedId = id;
    const next = id && tileOf.get(id);
    if (next) next.node.classList.add('is-selected');
    renderPanel(id ? byId.get(id) : null);
    drawLineage();
    syncTyping();
  }

  // ---- search ----------------------------------------------------------------

  function applySearch(raw) {
    const q = raw.trim().toLowerCase();
    let hits = 0;
    for (const t of tiles) {
      const a = t.a;
      const hit =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.worktree.toLowerCase().includes(q) ||
        a.displayProject.toLowerCase().includes(q) ||
        a.agentType.toLowerCase().includes(q) ||
        a.state.includes(q) ||
        STATE_LABEL[a.state].toLowerCase().includes(q);
      // Matches keep their position; misses only lose opacity.
      t.node.classList.toggle('is-dim', Boolean(q) && !hit);
      if (hit && q) hits++;
    }
    const dead = Boolean(q) && hits === 0;
    el.empty.hidden = !dead;
    if (dead) el.empty.textContent = 'No agents match “' + raw.trim() + '”';
  }

  // ---- needs-you cycle -------------------------------------------------------

  const rank = new Map();
  let ri = 0;
  for (const g of F.byWorktree) for (const a of g.agents) rank.set(a.id, ri++);
  const needsYou = F.buckets.needsYou
    .slice()
    .sort(
      (x, y) => F.severityRank(x.state) - F.severityRank(y.state) || rank.get(x.id) - rank.get(y.id),
    );
  let focusIdx = -1;

  function focusNext() {
    if (!needsYou.length) return;
    focusIdx = (focusIdx + 1) % needsYou.length;
    const a = needsYou[focusIdx];
    select(a.id);
    const c = tileCentre(tileOf.get(a.id));
    animateTo(centreTransform(c.x, c.y, FOCUS_SCALE));
    userMoved = true;
  }

  // ---- drag: pan the view, arrange the furniture -----------------------------

  let drag = null;
  let suppressClick = false;
  let userMoved = false;

  function updateResetButton() {
    el.reset.disabled = Object.keys(deltas).length === 0;
  }

  el.stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.viewtools') || e.target.closest('.minimap')) return;
    userMoved = true;
    suppressClick = false;
    const head = e.target.closest('.isl-head');
    const label = e.target.closest('.wt-label');
    if (head) {
      const isl = islandByName.get(head.parentNode.dataset.island);
      drag = { mode: 'island', isl, key: 'island:' + isl.name };
    } else if (label) {
      const g = groupByKey.get(label.parentNode.dataset.group);
      drag = { mode: 'group', g, key: 'wt:' + g.key };
    } else {
      drag = { mode: 'pan', tx: tf.x, ty: tf.y };
      el.stage.classList.add('is-panning');
    }
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    drag.moved = false;
    if (drag.key) {
      const d = deltaOf(drag.key);
      drag.d0 = { dx: d.dx, dy: d.dy };
      e.preventDefault(); // a header drag must not start a text selection
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.abs(dx) <= DRAG_THRESHOLD_PX && Math.abs(dy) <= DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      hideTip();
      if (drag.mode !== 'pan') el.stage.classList.add('is-arranging');
    }
    if (drag.mode === 'pan') {
      tf.x = drag.tx + dx;
      tf.y = drag.ty + dy;
      applyTransform();
      return;
    }
    // Furniture moves in world units, so it tracks the cursor at any zoom.
    deltas[drag.key] = { dx: drag.d0.dx + dx / tf.scale, dy: drag.d0.dy + dy / tf.scale };
    if (drag.mode === 'island') {
      positionIsland(drag.isl);
    } else {
      drag.g.node.classList.add('is-arranged');
      positionGroup(drag.g);
    }
    drawLineage();
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const done = drag;
    drag = null;
    el.stage.classList.remove('is-panning', 'is-arranging');
    suppressClick = done.moved;
    if (done.mode === 'pan' || !done.moved) return;
    // Dots are static except when the furniture moves, so this is the one place
    // the minimap has to redraw them.
    saveLayout();
    updateResetButton();
    renderMinimap();
  });

  // ---- minimap navigation ----------------------------------------------------

  let mmDragging = false;

  function recentreFrom(e) {
    const p = minimapWorldPoint(e);
    if (!p) return;
    const t = centreTransform(p.x, p.y, tf.scale);
    tf = t;
    applyTransform();
    userMoved = true;
  }

  el.minimap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    mmDragging = true;
    recentreFrom(e);
  });
  window.addEventListener('mousemove', (e) => {
    if (mmDragging) recentreFrom(e);
  });
  window.addEventListener('mouseup', () => {
    mmDragging = false;
  });

  // ---- wiring ----------------------------------------------------------------

  renderChrome();
  buildWorld();
  renderMinimap();
  updateResetButton();

  // Native listeners with { passive: false }: the page must not scroll or page-zoom
  // while the canvas is being manipulated.
  el.stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      userMoved = true;
      // Chromium delivers a trackpad pinch as a ctrlKey wheel with small deltas;
      // both paths zoom here, pinch at higher sensitivity.
      const sensitivity = e.ctrlKey ? 0.02 : 0.0015;
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * sensitivity));
    },
    { passive: false },
  );

  // macOS Chromium also emits WebKit-legacy gesture events for trackpad pinch, and
  // in some windows that is the only path that fires.
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
    // mouseup runs before click, so a finished drag is already flagged here.
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (e.target.closest('.viewtools') || e.target.closest('.minimap')) return;
    const node = e.target.closest('.tile');
    if (!node) {
      if (selectedId) select(null);
      return;
    }
    select(node.dataset.agent === selectedId ? null : node.dataset.agent);
  });

  el.stage.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tile') || e.target.closest('.minimap')) return;
    fitAll(FIT_FLOOR);
  });

  el.stage.addEventListener('mouseover', (e) => {
    if (drag) return;
    const node = e.target.closest('.tile');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.stage.addEventListener('mouseout', (e) => {
    if (e.target.closest('.tile')) hideTip();
  });
  el.stage.addEventListener('focusin', (e) => {
    const node = e.target.closest('.tile');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.stage.addEventListener('focusout', hideTip);
  el.stage.addEventListener('keydown', (e) => {
    const node = e.target.closest('.tile');
    if (node && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      select(node.dataset.agent === selectedId ? null : node.dataset.agent);
    }
  });

  el.fit.addEventListener('click', () => {
    userMoved = true;
    fitAll(FIT_FLOOR);
  });
  el.reset.addEventListener('click', () => {
    for (const k of Object.keys(deltas)) delete deltas[k];
    try {
      window.localStorage.removeItem(LAYOUT_KEY);
    } catch (err) {
      /* nothing persisted, nothing to clear */
    }
    for (const i of islands) positionIsland(i);
    for (const g of groups) {
      g.node.classList.remove('is-arranged');
      positionGroup(g);
    }
    updateResetButton();
    renderMinimap();
    drawLineage();
  });

  el.search.addEventListener('input', () => applySearch(el.search.value));
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'k' && (IS_MAC ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      el.search.focus();
      el.search.select();
      return;
    }
    const typing = e.target === el.search || e.target instanceof HTMLInputElement;
    if (e.key.toLowerCase() === 'f' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      focusNext();
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
  window.addEventListener('resize', () => {
    rectCache = null;
    if (!userMoved) fitAll(FIT_FLOOR);
    else updateMinimapView();
  });

  // Pre-seed: frame the whole fleet in the mid band, then open the one needs-you
  // agent whose parent lives in another repo — the first paint carries a
  // cross-island lineage arc and the numbered reply panel.
  fitAll(FIT_FLOOR);
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
  if (seed) {
    select(seed.id);
    focusIdx = needsYou.indexOf(seed);
  }
  userMoved = false;
})();
