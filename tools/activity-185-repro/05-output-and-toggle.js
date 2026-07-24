(async () => {
  const WT = '502310a9-4ede-4ceb-bca1-5c10521b2ece::C:\\Users\\neil\\OneDrive\\Documents\\PowerShell';
  const ptyA = WT + '@@02ce43db'; // THREAD_A_HEALTHY
  const labels = ['THREAD_A_HEALTHY', 'Agent unavailable after pane identity migration'];
  const findRow = (label) =>
    [...document.querySelectorAll('[role=button]')].find(
      (el) => (el.className || '').includes('cursor-pointer') && (el.textContent || '').includes(label)
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__ACTIVITY_185_SNAPSHOTS = [];
  window.__REACT185_ERRORS = [];

  // select healthy A first so it portals in and renders
  findRow(labels[0])?.click();
  await sleep(200);
  // start continuous output on A's pty
  window.api.pty.write(ptyA, 'for($i=0;$i -lt 600;$i++){ Write-Host "out $i $(Get-Random)"; Start-Sleep -Milliseconds 15 }\r');

  const gap = window.__togGap ?? 25;
  const iters = window.__togIters ?? 80;
  let missing = 0;
  for (let i = 0; i < iters; i++) {
    const row = findRow(labels[i % 2]);
    if (row) row.click();
    else missing++;
    await sleep(gap);
    if (/hit an error/i.test(document.body.textContent || '')) break;
  }
  await sleep(500);
  // stop the output loop
  try { window.api.pty.write(ptyA, '\x03'); } catch {}
  const snaps = window.__ACTIVITY_185_SNAPSHOTS || [];
  return {
    gap, iters, missing,
    boundaryTripped: /hit an error/i.test(document.body.textContent || ''),
    react185Errors: (window.__REACT185_ERRORS || []).length,
    tripped: snaps.length,
    maxRenders: snaps.reduce((m, s) => Math.max(m, s.rendersInWindow || 0), 0),
    lastSnapshot: snaps[snaps.length - 1] || null
  };
})()
