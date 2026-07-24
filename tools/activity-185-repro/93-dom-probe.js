(async () => {
  const findRow = (l) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(l)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__REACT185_ERRORS = [];
  // Click P1 a few times with settle gaps to register selection + let portal mount.
  for (let i = 0; i < 3; i++) { findRow('SAMETAB_P1')?.click(); await sleep(400); }
  await sleep(1500);
  const trace = window.__ACTIVITY_185_TRACE || [];
  const sels = new Set(trace.map((e) => e.sel));
  const disps = new Set(trace.map((e) => e.disp));
  const vsts = new Set(trace.map((e) => e.vSt));
  // Inspect DOM: any Activity portal terminal for tab 67760f3a?
  const TAB = '67760f3a-cedc-4326-ba1c-fb44b8235228';
  const roots = [...document.querySelectorAll('[data-terminal-tab-id]')].map((el) => ({
    tabId: el.dataset.terminalTabId,
    hasPty: !!el.querySelector('[data-pty-id]'),
    hasXterm: !!el.querySelector('.xterm-screen'),
    leafIds: [...el.querySelectorAll('[data-leaf-id]')].map((x) => x.dataset.leafId?.slice(0, 8))
  }));
  const tabRoots = roots.filter((r) => r.tabId === TAB);
  return JSON.stringify({
    lastTrace: trace[trace.length - 1] || null,
    distinctSel: [...sels],
    distinctDisp: [...disps],
    distinctVSt: [...vsts],
    react185: (window.__REACT185_ERRORS || []).length,
    boundary: /hit an error/i.test(document.body.textContent || ''),
    domTerminalRootCount: roots.length,
    tabRootsForTAB: tabRoots,
    allTabIdsInDom: roots.map((r) => r.tabId?.slice(0, 8))
  });
})()
