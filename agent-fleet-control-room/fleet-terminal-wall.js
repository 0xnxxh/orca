/* Fleet Terminal Wall — 104 miniature terminals, one per agent, tiled as a video wall.
   The only text in the field is the agents' own output. Working tiles type; needs-you
   tiles are frozen on the line that needs a human; done tiles are silent dark rectangles.
   Ages come from FLEET.now; timers control pacing only, never content. */
(function () {
  'use strict';

  const F = window.FLEET;
  if (!F) throw new Error('fleet-state-synthesis.js must be loaded first');

  const IS_MAC = navigator.userAgent.includes('Mac');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STATE_LABEL = {
    attention: 'Waiting on your answer',
    permission: 'Waiting on permission',
    failed: 'Failed',
    working: 'Working',
    review: 'Ready to review',
    done: 'Done',
  };

  // Plausible terminal output. {detail} / {wt} are filled per agent so tool-call lines
  // echo what that agent is actually doing.
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

  const MAX_LINES = 14;
  const GAP = 8;
  const MICRO_GAP = 5;
  const MICRO_H = 28;
  const LABEL_H = 18; // 12px eyebrow line + 6px margin
  const C_RATIO = 0.64; // review tiles read as a smaller sibling of the big screens
  const COLS = { a: 6, b: 6, c: 7, d: 32 };

  const el = {
    wall: document.getElementById('wall'),
    chips: document.getElementById('chips'),
    accounting: document.getElementById('accounting'),
    whisper: document.getElementById('whisper'),
    search: document.getElementById('search'),
    panel: document.getElementById('panel'),
    tip: document.getElementById('tip'),
  };

  const byId = new Map(F.agents.map((a) => [a.id, a]));
  const nodeOf = new Map();
  const streams = new Map();
  let selectedId = null;

  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const liveness = (a) =>
    a.loopSleeping ? 'loop sleeping' : a.alive ? 'process live' : 'process exited';
  const fill = (line, a) => line.replace('{detail}', a.detail || 'thinking').replace('{wt}', a.worktree);

  // ---- band membership -------------------------------------------------------

  // Spatial stability: byWorktree order (alpha worktree, then startedAt) is the base
  // rank everywhere; NEEDS YOU layers severity on top so failures lead.
  const rank = new Map();
  let k = 0;
  for (const g of F.byWorktree) for (const a of g.agents) rank.set(a.id, k++);
  const byRank = (x, y) => rank.get(x.id) - rank.get(y.id);

  const BANDS = [
    {
      key: 'a',
      label: 'NEEDS YOU',
      agents: F.buckets.needsYou
        .slice()
        .sort((x, y) => F.severityRank(x.state) - F.severityRank(y.state) || byRank(x, y)),
    },
    { key: 'b', label: 'WORKING', agents: F.buckets.working.slice().sort(byRank) },
    { key: 'c', label: 'TO REVIEW', agents: F.buckets.review.slice().sort(byRank) },
    { key: 'd', label: 'DONE', agents: F.buckets.done.slice().sort(byRank) },
  ];
  const gridOf = {};

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
        .map((x) => '<span class="key"><i class="dot" style="--hue:' + x[0] + '"></i>' + x[1] + '</span>')
        .join('<span class="sep">·</span>') +
      '<span class="sep">·</span><span>motion = output</span>';
  }

  // ---- line streams ----------------------------------------------------------

  function makeStream(a) {
    const h = F.hash(a.id);
    const st = {
      agent: a,
      h,
      i: 0,
      stride: 1 + (h % 5), // each tile walks the pool on its own step
      lines: F.fakeTail(a).slice(),
      cursor: a.state === 'working' && !a.loopSleeping,
    };
    if (a.state === 'permission') {
      const d = F.decisions.find((x) => x.key === a.decisionKey);
      st.lines = pull(st, 3).concat(['', 'Waiting for permission: $ ' + (d ? d.command : '')]);
    } else if (a.state === 'failed') {
      st.lines = pull(st, 2).concat(['$ ' + F.decisions[0].command, '', a.failure]);
    } else if (a.loopSleeping) {
      st.lines = st.lines.concat(['', '☾ sleeping · next run 4m']);
    } else if (a.state === 'working') {
      // Stagger the starting depth so the first frame already looks mid-work.
      st.lines = st.lines.concat(pull(st, 1 + (h % 8)));
    }
    trim(st);
    streams.set(a.id, st);
    return st;
  }

  function pull(st, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(fill(WORK_LINES[(st.h + st.i * st.stride) % WORK_LINES.length], st.agent));
      st.i += 1;
    }
    return out;
  }

  function trim(st) {
    if (st.lines.length > MAX_LINES) st.lines = st.lines.slice(-MAX_LINES);
  }

  // The newest line ellipsizes instead of hard-clipping, so the cursor — the whole
  // "this one is alive" signal — never falls off the right edge of a narrow tile.
  function lastLineHtml(st, text) {
    return (
      '<div class="last"><span class="txt">' + (esc(text) || '&nbsp;') + '</span>' +
      (st.cursor ? '<i class="cur">▍</i>' : '') + '</div>'
    );
  }

  function termHtml(st) {
    return st.lines
      .map((l, i) =>
        i === st.lines.length - 1 ? lastLineHtml(st, l) : '<div>' + esc(l) + '</div>',
      )
      .join('');
  }

  function paint(st) {
    const node = nodeOf.get(st.agent.id);
    const term = node && node.querySelector('.term');
    if (term) term.innerHTML = termHtml(st);
    if (selectedId === st.agent.id) paintPanelTail(st);
  }

  // Pacing only — jittered start and period so 16 tiles never fall into lockstep.
  function startTyping(st) {
    if (REDUCED) return;
    const period = 900 + (st.h % 1700);
    window.setTimeout(() => {
      const tick = () => {
        st.lines = st.lines.concat(pull(st, 1));
        trim(st);
        paint(st);
      };
      tick();
      window.setInterval(tick, period);
    }, Math.random() * 1800);
  }

  // ---- tiles -----------------------------------------------------------------

  function markHtml(a) {
    if (a.loopSleeping) return '<i class="mark crescent"></i>';
    if (a.state === 'working') return '<i class="mark dot"></i>';
    if (a.state === 'review') return '<span class="mark">✔</span>';
    return '';
  }

  function buildTile(a, micro) {
    const node = document.createElement('div');
    node.className = 'tile' + (micro ? ' micro' : '');
    node.dataset.agent = a.id;
    node.dataset.state = a.state;
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute(
      'aria-label',
      a.shortName + ' — ' + STATE_LABEL[a.state] + ', ' + a.displayProject + '/' + a.worktree,
    );
    if (micro) {
      node.innerHTML = a.pr ? '<span class="pr">#</span>' : '';
    } else {
      const st = makeStream(a);
      node.innerHTML =
        markHtml(a) +
        '<div class="term">' + termHtml(st, false) + '</div>' +
        '<div class="who">' + esc(a.shortName) + '</div>';
      if (a.state === 'working' && !a.loopSleeping) startTyping(st);
    }
    nodeOf.set(a.id, node);
    return node;
  }

  function renderWall() {
    for (const band of BANDS) {
      const section = document.createElement('section');
      section.className = 'band-wrap';
      const label = document.createElement('p');
      label.className = 'eyebrow band-label';
      label.textContent = band.label + ' · ' + band.agents.length;
      const grid = document.createElement('div');
      grid.className = 'band' + (band.key === 'd' ? ' band-micro' : '');
      for (const a of band.agents) grid.appendChild(buildTile(a, band.key === 'd'));
      section.append(label, grid);
      el.wall.appendChild(section);
      gridOf[band.key] = grid;
    }
  }

  // ---- layout: solve tile height so all 104 tiles fit with no scrolling -------

  function layout() {
    const cs = getComputedStyle(el.wall);
    const H = el.wall.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const rows = {};
    for (const band of BANDS) rows[band.key] = Math.ceil(band.agents.length / COLS[band.key]);

    const fixed =
      BANDS.length * LABEL_H +
      (BANDS.length - 1) * GAP +
      (rows.a - 1) * GAP +
      (rows.b - 1) * GAP +
      (rows.c - 1) * GAP +
      (rows.d - 1) * MICRO_GAP +
      rows.d * MICRO_H;

    const free = H - fixed;
    const h = Math.max(74, Math.min(168, Math.floor(free / (rows.a + rows.b + rows.c * C_RATIO))));

    const heights = { a: h, b: h, c: Math.floor(h * C_RATIO), d: MICRO_H };
    for (const band of BANDS) {
      gridOf[band.key].style.setProperty('--cols', COLS[band.key]);
      gridOf[band.key].style.setProperty('--tile-h', heights[band.key] + 'px');
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

  const hideTip = () => {
    el.tip.hidden = true;
  };

  // ---- selection panel -------------------------------------------------------

  const PANEL_LINES = 12;

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
      '<div><div class="eyebrow">Tool</div><div class="p-path">' + esc(a.detail || '—') + '</div></div>' +
      '<div class="p-tail"></div>' +
      '</div>' +
      '<div class="p-respond">' + respondHtml(a) + '</div>';

    const st = streams.get(a.id) || makeStream(a);
    paintPanelTail(st);
    el.panel.classList.add('is-open');
    el.panel.setAttribute('aria-hidden', 'false');
    el.panel.querySelector('.panel-close').addEventListener('click', () => select(null));
  }

  function select(id) {
    if (selectedId && nodeOf.has(selectedId)) nodeOf.get(selectedId).classList.remove('is-selected');
    selectedId = id;
    if (id && nodeOf.has(id)) nodeOf.get(id).classList.add('is-selected');
    renderPanel(id ? byId.get(id) : null);
  }

  // ---- search: dim misses, never reflow --------------------------------------

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
  renderWall();
  layout();

  el.wall.addEventListener('click', (e) => {
    const node = e.target.closest('[data-agent]');
    if (!node) return;
    select(node.dataset.agent === selectedId ? null : node.dataset.agent);
  });
  el.wall.addEventListener('mouseover', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.wall.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-agent]')) hideTip();
  });
  el.wall.addEventListener('focusin', (e) => {
    const node = e.target.closest('[data-agent]');
    if (node) showTip(node, byId.get(node.dataset.agent));
  });
  el.wall.addEventListener('focusout', hideTip);
  el.wall.addEventListener('keydown', (e) => {
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
  window.addEventListener('resize', layout);
})();
