export const APPKIT_REPRO_TERMINAL_COUNT = 14

export function buildDashboardActivityScript(terminalCount = APPKIT_REPRO_TERMINAL_COUNT) {
  return `(async () => {
    const store = window.__store;
    if (!store) throw new Error('window.__store unavailable');
    await store.getState().fetchRepos();
    const repo = store.getState().repos.find((candidate) => candidate.displayName === 'appkit-repro')
      ?? store.getState().repos[0];
    if (!repo) throw new Error('No repository available for dashboard activity');
    await store.getState().fetchWorktrees(repo.id);
    const worktree = (store.getState().worktreesByRepo[repo.id] ?? [])
      .find((candidate) => candidate.path === repo.path)
      ?? (store.getState().worktreesByRepo[repo.id] ?? [])[0];
    if (!worktree) throw new Error('No worktree available for dashboard activity');
    store.getState().setActiveRepo(repo.id);
    store.getState().setActiveWorktree(worktree.id);
    const repoId = repo.id;
    const worktreeId = worktree.id;

    const tabIds = [];
    for (let index = 0; index < ${terminalCount}; index++) {
      const tab = store.getState().createTab(worktreeId, undefined, undefined, {
        activate: true,
        recordInteraction: false
      });
      tabIds.push(tab.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const deadline = Date.now() + 30000;
    let tabs = [];
    while (Date.now() < deadline) {
      tabs = store.getState().tabsByWorktree[worktreeId] ?? [];
      if (tabIds.every((id) => tabs.find((tab) => tab.id === id)?.ptyId)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const activeTabs = tabs.filter((tab) => tabIds.includes(tab.id) && tab.ptyId);
    if (activeTabs.length !== tabIds.length) {
      throw new Error('Only ' + activeTabs.length + ' of ' + tabIds.length + ' terminal PTYs mounted');
    }

    for (const [index, tab] of activeTabs.entries()) {
      const command = "while :; do printf 'appkit-repro-" + index + "-%s\\n' $SECONDS; sleep 1; done\\r";
      window.api.pty.write(tab.ptyId, command);
    }

    let tick = 0;
    const publish = () => {
      const now = Date.now();
      const liveTabs = store.getState().tabsByWorktree[worktreeId] ?? [];
      const cards = tabIds.map((tabId, index) => {
        const tab = liveTabs.find((candidate) => candidate.id === tabId);
        const phase = (tick + index) % 4;
        const dotState = phase === 0 ? 'waiting' : phase === 1 ? 'working' : phase === 2 ? 'done' : 'idle';
        const bucket = dotState === 'waiting' ? 'attention' : dotState === 'working' ? 'working' : dotState === 'done' ? 'done' : 'idle';
        return {
          paneKey: worktreeId + ':' + tabId,
          ptyId: tab?.ptyId ?? null,
          agentType: 'codex',
          bucket,
          dotState,
          task: 'AppKit dashboard activity ' + (index + 1),
          lastUserMessage: 'Keep the mobile Home screen connected',
          lastAgentMessage: 'Terminal output tick ' + tick,
          repoId,
          worktreeId,
          tabId,
          leafId: null,
          repoName: 'appkit-repro',
          worktreeName: 'main',
          hostKind: 'local',
          workspaceKind: 'worktree',
          startedAt: now - 300000 - index * 1000,
          finishedAt: dotState === 'done' ? now : null,
          stateChangedAt: now,
          statusUpdatedAt: now,
          unseen: dotState === 'waiting' || dotState === 'done',
          ...(dotState === 'waiting' ? { askSummary: 'Waiting for user input' } : {})
        };
      });
      void window.api.dashboard.publishSnapshot({
        generatedAt: now,
        cards,
        workspaces: [{
          repoId,
          worktreeId,
          repoName: 'appkit-repro',
          worktreeName: 'main',
          hostKind: 'local',
          executionHostId: 'local',
          workspaceKind: 'worktree'
        }],
        showIdle: true,
        filterOptions: { projects: [{ id: repoId, label: 'appkit-repro' }], workspaceStatuses: [] },
        launchableAgentsByWorktreeId: {},
        repoIconsByRepoId: {}
      }).catch(() => {});
      tick++;
    };
    publish();
    const dashboardTimer = setInterval(publish, 500);
    let activeIndex = 0;
    const terminalTimer = setInterval(() => {
      store.getState().setActiveTab(tabIds[activeIndex % tabIds.length]);
      activeIndex++;
    }, 2000);
    globalThis.__appkitDashboardActivity = { dashboardTimer, terminalTimer, tabIds };
    return JSON.stringify({ terminalCount: activeTabs.length, worktreeId, repoId });
  })()`
}
