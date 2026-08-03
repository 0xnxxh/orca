/* Fleet · Inbox — renders the calm view from window.FLEET. */
(function () {
  'use strict';
  const F = window.FLEET;
  const attention = F.agents.filter((a) => a.state === 'attention');
  const failed = F.agents.filter((a) => a.state === 'failed');
  const review = F.agents
    .filter((a) => a.state === 'review')
    .sort((x, y) => (y.completedAt || 0) - (x.completedAt || 0));
  const working = F.buckets.working;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- header ---------------------------------------------------------------
  const items = F.decisions.length + attention.length + 1; // failures grouped as one
  const biggest = Math.max(...F.decisions.map((d) => d.agents.length));
  document.getElementById('headline').textContent = 'Needs you';
  document.getElementById('subline').textContent =
    items + ' items · one approval unblocks ' + biggest + ' agents';

  const cards = document.getElementById('cards');

  // ---- approval cards -------------------------------------------------------
  F.decisions.forEach((d) => {
    const card = el('article', 'card');
    const ctx = el('div', 'card-context');
    ctx.append(el('i', 'dot dot-attention'));
    const projects = [...new Set(d.agents.map((a) => a.displayProject))].join(', ');
    ctx.append(el('span', null, d.agents.length + ' agents waiting · ' + projects));
    const avatars = el('div', 'avatars');
    d.agents.slice(0, 4).forEach((a) => avatars.append(el('span', 'avatar', a.agentType[0].toUpperCase())));
    ctx.append(avatars);

    const title = el('h2', 'card-title');
    title.append('Allow ', Object.assign(el('code'), { textContent: d.command }), '?');

    const actions = el('div', 'card-actions');
    const deny = el('button', 'btn btn-ghost', 'Deny');
    const allow = el('button', 'btn btn-primary', 'Allow');
    allow.addEventListener('click', () => {
      card.classList.add('is-resolved');
      ctx.lastChild.remove();
      title.textContent = 'Allowed ' + d.command;
      card.querySelector('.card-sub')?.remove();
      title.after(el('p', 'card-sub', d.agents.length + ' agents resuming'));
    });
    actions.append(el('span', 'spacer'), deny, allow);

    card.append(ctx, title, el('p', 'card-sub', d.detail), actions);
    cards.append(card);
  });

  // ---- question cards (first expanded, rest one line) -----------------------
  attention.forEach((a, i) => {
    const card = el('article', 'card' + (i === 0 ? '' : ' is-compact'));
    if (i === 0) {
      const ctx = el('div', 'card-context');
      ctx.append(el('i', 'dot dot-attention'), el('span', null, a.shortName));
      const q = el('p', 'card-question', a.question.text);
      const actions = el('div', 'card-actions');
      a.question.options.forEach((opt) => {
        const b = el('button', 'btn', opt);
        b.addEventListener('click', () => {
          card.classList.add('is-resolved');
          q.textContent = 'Answered — ' + opt;
        });
        actions.append(b);
      });
      actions.append(el('button', 'btn btn-ghost', 'Reply…'));
      card.append(ctx, q, actions);
    } else {
      card.append(
        el('i', 'dot dot-attention'),
        el('p', 'card-question', a.question.text),
        el('span', 'chevron', '›'),
      );
      card.addEventListener('click', () => card.classList.add('is-resolved'));
    }
    cards.append(card);
  });

  // ---- failures, grouped into one card --------------------------------------
  const fcard = el('article', 'card is-compact');
  fcard.append(
    el('i', 'dot dot-blocked'),
    el('p', 'card-question', failed.length + ' agents stopped — ' + failed[0].failure),
    el('span', 'chevron', '›'),
  );
  cards.append(fcard);

  // ---- the rest of the fleet ------------------------------------------------
  const rest = document.getElementById('rest');
  function row(dotCls, label, count, subRows) {
    const r = el('div', 'rest-row');
    r.append(el('i', 'dot ' + dotCls), el('span', 'rest-label', label), el('span', 'rest-count', String(count)), el('span', 'chevron', '›'));
    rest.append(r);
    if (subRows) {
      const list = el('div', 'rest-sublist');
      list.append(...subRows);
      rest.append(list);
      r.addEventListener('click', () => r.classList.toggle('is-open'));
    }
    return r;
  }

  row(
    'dot-working',
    'Working',
    working.length,
    working.slice(0, 5).map((a) => {
      const s = el('div', 'rest-sub-row');
      s.append(el('span', 'rest-sub-name', a.shortName), el('span', 'rest-sub-meta', a.detail || 'Working'));
      return s;
    }).concat(working.length > 5 ? [el('div', 'rest-sub-row rest-sub-more', working.length - 5 + ' more')] : []),
  );

  row(
    'dot-review',
    'Ready to review',
    review.length,
    review.slice(0, 5).map((a) => {
      const s = el('div', 'rest-sub-row');
      s.append(
        el('span', 'rest-sub-name', a.shortName),
        el('span', 'rest-sub-meta', (a.pr ? '#' + a.pr.number + ' · ' : '') + F.ageLabel(a.durationMs) + ' run'),
      );
      return s;
    }).concat(review.length > 5 ? [el('div', 'rest-sub-row rest-sub-more', review.length - 5 + ' more')] : []),
  );

  row('dot-done', 'Done', F.buckets.done.length, null);

  // ---- footer ---------------------------------------------------------------
  const t = new Date(F.now);
  const hh = t.getUTCHours() % 12 || 12;
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  document.getElementById('foot').textContent =
    F.counts.fleetTotal + ' agents across ' + F.counts.fleetWorktrees + ' worktrees · updated ' + hh + ':' + mm + ' PM';
})();
