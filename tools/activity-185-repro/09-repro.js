(async () => {
  const labels = ['SAMETAB_P1', 'SAMETAB_P2'];
  const findRow = (l) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(l)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ACTIVITY_185_SNAPSHOTS = [];
  window.__REACT185_ERRORS = [];
  const crashed = () =>
    (window.__REACT185_ERRORS || []).length > 0 || /hit an error/i.test(document.body.textContent || '');

  // warm up: isolate each pane once
  findRow(labels[0])?.click(); await sleep(200);
  findRow(labels[1])?.click(); await sleep(200);

  const rounds = window.__reproRounds ?? 10;
  let round = 0;
  for (; round < rounds; round++) {
    for (let i = 0; i < 40; i++) {
      findRow(labels[i % 2])?.click();
      await Promise.resolve(); // microtask spacing (gap 0)
      if (crashed()) break;
    }
    if (crashed()) break;
    await sleep(30);
    if (crashed()) break;
  }
  await sleep(300);
  const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
  return {
    roundsRun: round + 1,
    react185: (window.__REACT185_ERRORS || []).length,
    react185Text: (window.__REACT185_ERRORS || [])[0]?.text?.slice(0, 160) || null,
    boundary: /hit an error/i.test(document.body.textContent || ''),
    detectorSnaps: snaps.length,
    snapshot: snaps[0] || null
  };
})()
