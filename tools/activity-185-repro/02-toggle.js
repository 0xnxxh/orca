(async () => {
  const cfg = window.__reproConfig || { count: 12, gapMs: 60, labels: ['THREAD_A_HEALTHY', 'THREAD_B_UNSUPPORTED'] };
  const findRow = (label) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(label)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snapBefore = (window.__ACTIVITY_185_SNAPSHOTS || []).length;
  const errBefore = (window.__REACT185_ERRORS || []).length;
  const clicks = [];
  for (let i = 0; i < cfg.count; i++) {
    const label = cfg.labels[i % cfg.labels.length];
    const row = findRow(label);
    if (!row) {
      clicks.push({ i, label, found: false });
      await sleep(cfg.gapMs);
      continue;
    }
    row.click();
    clicks.push({ i, label, found: true });
    await sleep(cfg.gapMs);
  }
  // settle
  await sleep(300);
  const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
  return {
    config: cfg,
    clicks: clicks.filter((c) => !c.found).length ? clicks : 'all-found',
    boundaryTripped: /hit an error/i.test(document.body.textContent || ''),
    react185Errors: (window.__REACT185_ERRORS || []).slice(errBefore),
    newSnapshots: snaps.length - snapBefore,
    lastSnapshot: snaps[snaps.length - 1] || null
  };
})()
