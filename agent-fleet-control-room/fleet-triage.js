/* Fleet · Triage — list + detail from window.FLEET. */
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

  // ---- item list -------------------------------------------------------------
  const items = [];
  F.decisions.forEach((d) => items.push({ type: 'decision', d }));
  attention.forEach((a) => items.push({ type: 'question', a }));
  items.push({ type: 'failures' });
  working.slice(0, 4).forEach((a) => items.push({ type: 'working', a }));
  review.slice(0, 4).forEach((a) => items.push({ type: 'review', a }));

  const needsYouCount = F.decisions.length + attention.length + 1;
  document.getElementById('list-counts').textContent = needsYouCount + ' need you';

  const sections = document.getElementById('sections');
  const rows = new Map();
  let selected = null;

  function addLabel(text, n) {
    const l = el('div', 'section-label', text);
    l.append(el('span', 'n', String(n)));
    sections.append(l);
  }
  function addItem(item, dotCls, title, meta, titleIsCode) {
    const r = el('div', 'item');
    const t = el('span', 'item-title');
    if (titleIsCode) {
      t.append('Allow ', Object.assign(el('code'), { textContent: title }));
    } else {
      t.textContent = title;
    }
    r.append(el('i', 'dot ' + dotCls), t);
    if (meta) r.append(el('span', 'item-meta', meta));
    r.addEventListener('click', () => select(item));
    sections.append(r);
    rows.set(item, r);
  }
  function addMore(n) {
    sections.append(el('div', 'item-more', n + ' more'));
  }

  addLabel('Needs you', needsYouCount);
  items.forEach((it) => {
    if (it.type === 'decision') {
      addItem(it, 'dot-attention', it.d.command, it.d.agents.length + ' agents', true);
    } else if (it.type === 'question') {
      addItem(it, 'dot-attention', it.a.question.text, F.ageLabel(it.a.startedAgo));
    } else if (it.type === 'failures') {
      addItem(it, 'dot-blocked', failed.length + ' agents stopped on errors', null);
    }
  });

  addLabel('Working', working.length);
  items.filter((i) => i.type === 'working').forEach((it) => {
    addItem(it, 'dot-working', it.a.shortName, it.a.loopSleeping ? 'sleeping' : F.ageLabel(it.a.startedAgo));
  });
  addMore(working.length - 4);

  addLabel('Ready to review', review.length);
  items.filter((i) => i.type === 'review').forEach((it) => {
    addItem(it, 'dot-review', it.a.shortName, (it.a.pr ? '#' + it.a.pr.number : F.ageLabel(it.a.durationMs)));
  });
  addMore(review.length - 4);

  addLabel('Done', F.buckets.done.length);

  // ---- footer ----------------------------------------------------------------
  const foot = document.getElementById('list-foot');
  const t = new Date(F.now);
  foot.append(
    el('span', null, F.counts.fleetTotal + ' agents · ' + F.counts.fleetWorktrees + ' worktrees'),
    (() => {
      const links = el('span');
      [['Inbox', 'fleet-inbox'], ['Hexmap', 'fleet-hexmap'], ['Wall', 'fleet-terminal-wall']].forEach(([label, f]) => {
        const a = el('a', null, label);
        a.href = './' + f + '.html';
        links.append(a);
      });
      return links;
    })(),
  );

  // ---- detail pane -----------------------------------------------------------
  const detail = document.getElementById('detail');

  function agentRow(a, meta) {
    const r = el('div', 'agent-row');
    r.append(
      el('span', 'avatar', a.agentType[0].toUpperCase()),
      el('span', 'agent-name', a.shortName),
      el('span', 'agent-meta', meta),
    );
    return r;
  }
  function tailBlock(a, label) {
    const b = el('div', 'block');
    b.append(el('p', 'block-label', label || 'Latest output'));
    const lines = F.fakeTail(a).slice(-7);
    const pre = el('pre', 'tail');
    lines.forEach((ln, i) => {
      const s = el('span', i === lines.length - 1 ? 'now' : null, ln + '\n');
      pre.append(s);
    });
    b.append(pre);
    return b;
  }
  function actionsRow(defs) {
    const row = el('div', 'actions');
    defs.forEach(([label, cls, fn]) => {
      const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
      if (fn) b.addEventListener('click', fn);
      row.append(b);
    });
    return row;
  }
  function replyRow(placeholder) {
    const row = el('div', 'reply');
    const input = Object.assign(el('input'), { placeholder });
    row.append(input, (() => {
      const b = el('button', 'btn', 'Send');
      return b;
    })());
    return row;
  }

  function render(item) {
    detail.replaceChildren();
    const inner = el('div', 'detail-inner');
    detail.append(inner);

    if (item.type === 'decision') {
      const d = item.d;
      const projects = [...new Set(d.agents.map((a) => a.displayProject))];
      inner.append(el('p', 'detail-kind', 'Permission request · ' + d.agents.length + ' agents · ' + projects.join(', ')));
      const h = el('h1');
      h.append('Allow ', Object.assign(el('code'), { textContent: d.command }));
      inner.append(h);
      inner.append(el('p', 'detail-sub', d.detail + '. ' + d.agents.length + ' agents are paused on this command; one decision resumes all of them.'));
      inner.append(actionsRow([
        ['Allow', 'btn-primary', () => resolved(inner, d.agents.length + ' agents resuming.')],
        ['Allow for ' + projects[0] + ' only', null, null],
        ['Deny', 'btn-ghost', null],
      ]));
      const wb = el('div', 'block');
      wb.append(el('p', 'block-label', 'Waiting'));
      d.agents.forEach((a) => wb.append(agentRow(a, a.worktree + ' · ' + F.ageLabel(a.startedAgo))));
      inner.append(wb, tailBlock(d.agents[0]));
    } else if (item.type === 'question') {
      const a = item.a;
      inner.append(el('p', 'detail-kind', 'Question · ' + a.agentType + ' · ' + a.worktree));
      inner.append(el('h1', null, a.question.text));
      inner.append(el('p', 'detail-sub', a.shortName));
      inner.append(actionsRow(a.question.options.map((opt, i) => [
        opt,
        i === 0 ? 'btn-primary' : null,
        () => resolved(inner, 'Answered — ' + opt),
      ])));
      inner.append(replyRow('Or answer in your own words…'), tailBlock(a));
    } else if (item.type === 'failures') {
      inner.append(el('p', 'detail-kind', 'Stopped · ' + failed.length + ' agents'));
      inner.append(el('h1', null, failed.length + ' agents stopped on errors'));
      inner.append(actionsRow([
        ['Retry both', 'btn-primary', null],
        ['Open terminal', null, null],
      ]));
      failed.forEach((a) => {
        const b = el('div', 'block');
        b.append(el('p', 'block-label', a.worktree));
        b.append(agentRow(a, F.ageLabel(a.startedAgo)));
        b.append(tailBlock(a, 'Error').lastChild);
        inner.append(b);
      });
    } else if (item.type === 'working') {
      const a = item.a;
      inner.append(el('p', 'detail-kind', 'Working · ' + a.agentType + ' · ' + a.worktree));
      inner.append(el('h1', null, a.shortName));
      inner.append(el('p', 'detail-sub', (a.detail || 'Working') + ' · running ' + F.ageLabel(a.startedAgo)));
      inner.append(replyRow('Queue a message — delivered when it pauses…'));
      inner.append(actionsRow([['Interrupt', 'btn-ghost', null]]), tailBlock(a, 'Live output'));
    } else if (item.type === 'review') {
      const a = item.a;
      inner.append(el('p', 'detail-kind', 'Ready to review · ' + a.agentType + ' · ' + a.worktree));
      inner.append(el('h1', null, a.shortName));
      inner.append(el('p', 'detail-sub', 'Finished · ' + F.ageLabel(a.durationMs) + ' run' + (a.pr ? ' · PR #' + a.pr.number : '')));
      inner.append(actionsRow([
        ['Review diff', 'btn-primary', null],
        ['Mark reviewed', null, () => resolved(inner, 'Reviewed. It will leave the list.')],
        ['Reopen', 'btn-ghost', null],
      ]));
      inner.append(tailBlock(a, 'Final output'));
    }
  }

  function resolved(inner, note) {
    inner.querySelector('.actions')?.remove();
    inner.querySelector('.reply')?.remove();
    inner.insertBefore(el('p', 'resolved-note', note), inner.querySelector('.block'));
  }

  function select(item) {
    if (selected) rows.get(selected)?.classList.remove('is-selected');
    selected = item;
    rows.get(item)?.classList.add('is-selected');
    render(item);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.target.tagName === 'INPUT') return;
    const i = items.indexOf(selected);
    const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) select(next);
    e.preventDefault();
  });

  select(items[0]);
})();
