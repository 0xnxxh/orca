(async () => {
  const labels = ['THREAD_A_HEALTHY', 'Agent unavailable after pane identity migration'];
  const findRow = (label) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(label)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gaps = (window.__sweepGaps) || [0, 8, 16, 30, 45];
  const perGap = (window.__sweepCount) || 24;
  const results = [];
  for (const gap of gaps) {
    window.__ACTIVITY_185_SNAPSHOTS = [];
    window.__REACT185_ERRORS = [];
    let missing = 0;
    for (let i = 0; i < perGap; i++) {
      const row = findRow(labels[i % 2]);
      if (row) row.click();
      else missing++;
      if (gap > 0) await sleep(gap);
      else await Promise.resolve();
    }
    await sleep(400);
    const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
    results.push({
      gap,
      missing,
      tripped: snaps.length,
      react185: (window.__REACT185_ERRORS || []).length,
      boundary: /hit an error/i.test(document.body.textContent || ''),
      maxRenders: snaps.reduce((m, s) => Math.max(m, s.rendersInWindow || 0), 0)
    });
    // recover boundary if tripped
    if (/hit an error/i.test(document.body.textContent || '')) break;
    await sleep(200);
  }
  return { results, lastSnapshot: (window.__ACTIVITY_185_SNAPSHOTS || []).slice(-1)[0] || null };
})()
