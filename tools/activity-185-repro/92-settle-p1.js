(async () => {
  const findRow = (l) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(l)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ACTIVITY_185_SNAPSHOTS = [];
  window.__REACT185_ERRORS = [];
  // Select ONLY P1 (the real pane) and let its portal settle to ready.
  findRow('SAMETAB_P1')?.click();
  await sleep(2500);
  const trace = window.__ACTIVITY_185_TRACE || [];
  const last = trace[trace.length - 1] || null;
  return JSON.stringify({
    p1RowFound: !!findRow('SAMETAB_P1'),
    lastDisp: last?.disp ?? null,
    lastSel: last?.sel ?? null,
    lastVis: last?.vis ?? null,
    lastVSt: last?.vSt ?? null,
    lastN: last?.n ?? null,
    lastFx: last?.fx ?? null,
    react185: (window.__REACT185_ERRORS || []).length,
    boundary: /hit an error/i.test(document.body.textContent || ''),
    fixmark: String(globalThis.__ACTIVITY185_FIXMARK)
  });
})()
