const STORAGE_KEY = "gitrac-dashboard-state";
const LOAD_MORE_PAGE_SIZE = 20;

const state = {
  user: null,
  authResolved: false,
  oauthReady: false,
  missingEnv: [],
  repos: [],
  selectedRepoId: null,
  lastSyncedAt: null,
  activeTab: "timeline",
  filters: {
    from: "",
    to: "",
  },
  loadState: {},
};

const page = document.body.dataset.page || "dashboard";

const elements = {
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  syncButton: document.querySelector("#syncButton"),
  clearButton: document.querySelector("#clearButton"),
  clearDateFilters: document.querySelector("#clearDateFilters"),
  statusMessage: document.querySelector("#statusMessage"),
  authSignedOut: document.querySelector("#authSignedOut"),
  authSignedIn: document.querySelector("#authSignedIn"),
  userAvatar: document.querySelector("#userAvatar"),
  userName: document.querySelector("#userName"),
  userLogin: document.querySelector("#userLogin"),
  exportPanel: document.querySelector("#exportPanel"),
  exportAllJson: document.querySelector("#exportAllJson"),
  exportAllCsv: document.querySelector("#exportAllCsv"),
  repoCount: document.querySelector("#repoCount"),
  metricRepos: document.querySelector("#metricRepos"),
  metricIssues: document.querySelector("#metricIssues"),
  metricOpenPrs: document.querySelector("#metricOpenPrs"),
  metricClosedPrs: document.querySelector("#metricClosedPrs"),
  searchInput: document.querySelector("#searchInput"),
  roleFilter: document.querySelector("#roleFilter"),
  sortFilter: document.querySelector("#sortFilter"),
  dateFrom: document.querySelector("#dateFrom"),
  dateTo: document.querySelector("#dateTo"),
  repoSummary: document.querySelector("#repoSummary"),
  repoList: document.querySelector("#repoList"),
  groupList: document.querySelector("#groupList"),
  repoActivityChart: document.querySelector("#repoActivityChart"),
  ownerDistributionChart: document.querySelector("#ownerDistributionChart"),
  repoPicker: document.querySelector("#repoPicker"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  detailLink: document.querySelector("#detailLink"),
  topicBadges: document.querySelector("#topicBadges"),
  detailIssueCount: document.querySelector("#detailIssueCount"),
  detailOpenPrCount: document.querySelector("#detailOpenPrCount"),
  detailClosedPrCount: document.querySelector("#detailClosedPrCount"),
  detailCommitCount: document.querySelector("#detailCommitCount"),
  issueCountLabel: document.querySelector("#issueCountLabel"),
  prCountLabel: document.querySelector("#prCountLabel"),
  commitCountLabel: document.querySelector("#commitCountLabel"),
  timelineCountLabel: document.querySelector("#timelineCountLabel"),
  timelineList: document.querySelector("#timelineList"),
  issueList: document.querySelector("#issueList"),
  prList: document.querySelector("#prList"),
  commitList: document.querySelector("#commitList"),
  detailPlaceholder: document.querySelector("#detailPlaceholder"),
  detailBody: document.querySelector("#detailBody"),
  exportRepoJson: document.querySelector("#exportRepoJson"),
  exportRepoCsv: document.querySelector("#exportRepoCsv"),
  loadMoreIssues: document.querySelector("#loadMoreIssues"),
  loadMorePrs: document.querySelector("#loadMorePrs"),
  loadMoreCommits: document.querySelector("#loadMoreCommits"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getDefaultLoadState() {
  return {
    issues: { nextPage: 2, hasMore: true, loading: false },
    pullRequests: { nextPage: 2, hasMore: true, loading: false },
    commits: { nextPage: 2, hasMore: true, loading: false },
  };
}

function ensureRepoLoadState(repoId) {
  if (!state.loadState[repoId]) {
    state.loadState[repoId] = getDefaultLoadState();
  }
  return state.loadState[repoId];
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const saved = JSON.parse(raw);
    state.repos = Array.isArray(saved.repos) ? saved.repos : [];
    state.selectedRepoId = saved.selectedRepoId || state.repos[0]?.id || null;
    state.lastSyncedAt = saved.lastSyncedAt || null;
    state.loadState = saved.loadState || {};
  } catch (error) {
    console.warn("Unable to load saved state", error);
  }
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      repos: state.repos,
      selectedRepoId: state.selectedRepoId,
      lastSyncedAt: state.lastSyncedAt,
      loadState: state.loadState,
    }),
  );
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
  state.repos = [];
  state.selectedRepoId = null;
  state.lastSyncedAt = null;
  state.loadState = {};
}

function setStatus(message, variant = "idle") {
  if (!elements.statusMessage) {
    return;
  }
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status ${variant}`;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Request failed with ${response.status}`);
  }

  return response.json();
}

async function loadConfig() {
  const config = await apiFetch("/api/config");
  state.oauthReady = config.oauthReady;
  state.missingEnv = config.missingEnv || [];
}

async function loadAuthStatus() {
  const auth = await apiFetch("/api/auth/status");
  state.user = auth.authenticated ? auth.user : null;
  state.authResolved = true;
}

function handleUrlMessage() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) {
    setStatus(`GitHub sign-in failed: ${error}`, "error");
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

async function initializeApp() {
  loadState();
  render();

  try {
    await loadConfig();
    await loadAuthStatus();
    handleUrlMessage();
    render();

    if (!state.oauthReady) {
      setStatus(`OAuth setup needed: ${state.missingEnv.join(", ")}`, "error");
    } else if (state.user) {
      setStatus(`Signed in as ${state.user.login}. Ready to sync.`, "success");
    } else {
      setStatus("Sign in with GitHub to sync repository activity.", "idle");
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not initialize the dashboard.", "error");
  }
}

async function syncData() {
  if (!state.user) {
    setStatus("Sign in with GitHub first.", "error");
    return;
  }

  setStatus("Syncing repositories and activity from GitHub...", "loading");
  if (elements.syncButton) {
    elements.syncButton.disabled = true;
  }

  try {
    const payload = await apiFetch("/api/sync");
    state.user = payload.user;
    state.repos = payload.repositories;
    state.selectedRepoId = payload.repositories[0]?.id || null;
    state.lastSyncedAt = payload.syncedAt;
    state.loadState = {};
    payload.repositories.forEach((repo) => {
      ensureRepoLoadState(repo.id);
    });
    persistState();
    render();
    setStatus(`Sync complete. Loaded ${payload.repositoryCount} repositories.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "GitHub sync failed.", "error");
  } finally {
    if (elements.syncButton) {
      elements.syncButton.disabled = false;
    }
  }
}

async function logout() {
  try {
    await apiFetch("/api/logout", { method: "POST" });
    state.user = null;
    state.authResolved = true;
    clearSavedState();
    render();
    setStatus("Signed out. Local session cleared.", "success");
  } catch (error) {
    setStatus(error.message || "Could not sign out.", "error");
  }
}

function getFilteredRepos() {
  if (!state.user) {
    return [];
  }

  const query = elements.searchInput?.value.trim().toLowerCase() || "";
  const roleFilter = elements.roleFilter?.value || "all";
  const sortFilter = elements.sortFilter?.value || "activity";
  let repos = [...state.repos];

  if (roleFilter !== "all") {
    repos = repos.filter((repo) => repo.role === roleFilter);
  }

  if (query) {
    repos = repos.filter((repo) => {
      const haystack = [repo.name, repo.fullName, repo.owner, repo.description, ...(repo.topics || [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  const sorters = {
    activity: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    name: (a, b) => a.fullName.localeCompare(b.fullName),
    issues: (a, b) => b.issueCount - a.issueCount,
    prs: (a, b) => b.openPrCount + b.closedPrCount - (a.openPrCount + a.closedPrCount),
  };

  return repos.sort(sorters[sortFilter]);
}

function getSelectedRepo() {
  if (!state.user) {
    return null;
  }
  return state.repos.find((item) => item.id === state.selectedRepoId) || null;
}

function getVisibleRepos() {
  return state.user ? state.repos : [];
}

function dateValueFromItem(section, item) {
  if (section === "issues") {
    return item.updatedAt || item.createdAt;
  }
  if (section === "pullRequests") {
    return item.updatedAt || item.createdAt;
  }
  return item.committedAt;
}

function isWithinDateRange(value) {
  if (!value) {
    return true;
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return true;
  }

  if (state.filters.from) {
    const from = new Date(`${state.filters.from}T00:00:00`);
    if (target < from) {
      return false;
    }
  }

  if (state.filters.to) {
    const to = new Date(`${state.filters.to}T23:59:59`);
    if (target > to) {
      return false;
    }
  }

  return true;
}

function getVisibleItems(repo, section) {
  return repo[section].filter((item) => isWithinDateRange(dateValueFromItem(section, item)));
}

function updateSelectedRepo(updater) {
  const repoIndex = state.repos.findIndex((item) => item.id === state.selectedRepoId);
  if (repoIndex === -1) {
    return;
  }

  const nextRepo = updater(state.repos[repoIndex]);
  state.repos.splice(repoIndex, 1, nextRepo);
  persistState();
  render();
}

async function loadMoreSection(section) {
  const repo = getSelectedRepo();
  if (!repo) {
    return;
  }

  const repoLoadState = ensureRepoLoadState(repo.id);
  const sectionState = repoLoadState[section];
  if (!sectionState?.hasMore || sectionState.loading) {
    return;
  }

  sectionState.loading = true;
  renderLoadButtons();
  setStatus(`Loading more ${section}...`, "loading");

  try {
    const payload = await apiFetch(
      `/api/repository-activity?repoId=${encodeURIComponent(repo.id)}&section=${encodeURIComponent(section)}&page=${sectionState.nextPage}&perPage=${LOAD_MORE_PAGE_SIZE}`,
    );

    const existingKey = section === "commits" ? "sha" : "id";
    updateSelectedRepo((currentRepo) => {
      const merged = [...currentRepo[section], ...payload.items].filter(
        (item, index, array) => array.findIndex((candidate) => candidate[existingKey] === item[existingKey]) === index,
      );
      return {
        ...currentRepo,
        [section]: merged,
      };
    });

    sectionState.nextPage += 1;
    sectionState.hasMore = payload.hasMore;
    sectionState.loading = false;
    persistState();
    renderLoadButtons();
    setStatus(`Loaded more ${section}.`, "success");
  } catch (error) {
    sectionState.loading = false;
    renderLoadButtons();
    setStatus(error.message || `Could not load more ${section}.`, "error");
  }
}

function renderRepoList() {
  if (!elements.repoList) {
    return;
  }

  const repos = getFilteredRepos();
  if (elements.repoSummary) {
    elements.repoSummary.textContent = `${repos.length} repositories shown`;
  }

  if (!repos.length) {
    elements.repoList.className = "repo-card-grid empty-state";
    elements.repoList.textContent = state.user
      ? "Sync your GitHub repositories to populate this list."
      : "Sign in with GitHub to begin tracking repository activity.";
    return;
  }

  elements.repoList.className = "repo-card-grid";
  elements.repoList.innerHTML = repos
    .map(
      (repo) => `
        <article class="repo-card ${repo.id === state.selectedRepoId ? "active" : ""}" data-repo-id="${repo.id}">
          <div class="repo-title-row">
            <h3>${escapeHtml(repo.fullName)}</h3>
            <span class="badge role-${repo.role}">${escapeHtml(repo.role)}</span>
          </div>
          <p>${escapeHtml(repo.description)}</p>
          <div class="badge-row">
            <span class="badge">${escapeHtml(repo.visibility)}</span>
            <span class="badge">${repo.issueCount} open issues</span>
            <span class="badge">${repo.openPrCount} open PRs</span>
          </div>
        </article>
      `,
    )
    .join("");

  elements.repoList.querySelectorAll(".repo-card").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedRepoId = Number(item.dataset.repoId);
      persistState();
      render();
    });
  });
}

function renderGroupList() {
  if (!elements.groupList) {
    return;
  }

  const displayRepos = getVisibleRepos();

  if (!displayRepos.length) {
    elements.groupList.className = "group-grid empty-state";
    elements.groupList.textContent = state.user
      ? "Sync repositories to see grouped activity by owner or team."
      : "Sign in to view grouped repository activity.";
    return;
  }

  const groups = Object.values(
    displayRepos.reduce((accumulator, repo) => {
      const key = repo.owner || "unknown";
      if (!accumulator[key]) {
        accumulator[key] = {
          owner: key,
          repositories: 0,
          openIssues: 0,
          openPrs: 0,
          collaboratorRepos: 0,
        };
      }

      accumulator[key].repositories += 1;
      accumulator[key].openIssues += repo.issueCount;
      accumulator[key].openPrs += repo.openPrCount;
      accumulator[key].collaboratorRepos += repo.role === "collaborator" ? 1 : 0;
      return accumulator;
    }, {}),
  ).sort((a, b) => b.repositories - a.repositories || a.owner.localeCompare(b.owner));

  elements.groupList.className = "group-grid";
  elements.groupList.innerHTML = groups
    .map(
      (group) => `
        <article class="group-card">
          <div class="repo-title-row">
            <h3>${escapeHtml(group.owner)}</h3>
            <span class="badge">${group.repositories} repos</span>
          </div>
          <p>${group.openIssues} open issues and ${group.openPrs} open PRs across this group.</p>
          <div class="badge-row">
            <span class="badge">${group.collaboratorRepos} collaborator repos</span>
            <span class="badge">${group.repositories - group.collaboratorRepos} owned repos</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderRepoPicker() {
  if (!elements.repoPicker) {
    return;
  }

  const displayRepos = getVisibleRepos();

  if (!displayRepos.length) {
    elements.repoPicker.innerHTML = '<option value="">No synced repositories</option>';
    elements.repoPicker.disabled = true;
    return;
  }

  elements.repoPicker.disabled = false;
  elements.repoPicker.innerHTML = displayRepos
    .map(
      (repo) =>
        `<option value="${repo.id}" ${repo.id === state.selectedRepoId ? "selected" : ""}>${escapeHtml(repo.fullName)}</option>`,
    )
    .join("");
}

function renderMetrics() {
  if (!elements.metricRepos) {
    return;
  }

  if (!state.user) {
    elements.metricRepos.textContent = "0";
    elements.metricIssues.textContent = "0";
    elements.metricOpenPrs.textContent = "0";
    elements.metricClosedPrs.textContent = "0";
    return;
  }

  const totals = getVisibleRepos().reduce(
    (accumulator, repo) => {
      accumulator.issues += repo.issueCount;
      accumulator.openPrs += repo.openPrCount;
      accumulator.closedPrs += repo.closedPrCount;
      return accumulator;
    },
    { issues: 0, openPrs: 0, closedPrs: 0 },
  );

  elements.metricRepos.textContent = String(getVisibleRepos().length);
  elements.metricIssues.textContent = String(totals.issues);
  elements.metricOpenPrs.textContent = String(totals.openPrs);
  elements.metricClosedPrs.textContent = String(totals.closedPrs);
}

function renderTimeline(repo) {
  if (!elements.timelineList) {
    return;
  }

  const entries = [
    ...getVisibleItems(repo, "issues").map((issue) => ({
      type: "Issue",
      title: `#${issue.number} ${issue.title}`,
      meta: `${issue.state} | ${issue.author} | updated ${formatDate(issue.updatedAt)}`,
      url: issue.htmlUrl,
      date: issue.updatedAt || issue.createdAt,
    })),
    ...getVisibleItems(repo, "pullRequests").map((pr) => ({
      type: "PR",
      title: `#${pr.number} ${pr.title}`,
      meta: `${pr.state}${pr.mergedAt ? " | merged" : ""} | ${pr.author} | updated ${formatDate(pr.updatedAt)}`,
      url: pr.htmlUrl,
      date: pr.updatedAt || pr.createdAt,
    })),
    ...getVisibleItems(repo, "commits").map((commit) => ({
      type: "Commit",
      title: `${commit.shortSha} ${commit.message}`,
      meta: `${commit.author} | committed ${formatDate(commit.committedAt)}`,
      url: commit.htmlUrl,
      date: commit.committedAt,
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  elements.timelineList.innerHTML = renderStackItems(
    entries,
    (entry) => `${entry.type} | ${entry.title}`,
    (entry) => entry.meta,
    (entry) => entry.url,
  );

  if (elements.timelineCountLabel) {
    elements.timelineCountLabel.textContent = `${entries.length} visible items`;
  }
}

function renderRepoDetails() {
  const repo = getSelectedRepo();

  if (!repo) {
    if (elements.detailTitle) {
      elements.detailTitle.textContent = "Select a repository";
    }
    if (elements.detailMeta) {
      elements.detailMeta.textContent = "";
    }
    if (elements.detailLink) {
      elements.detailLink.classList.add("hidden");
    }
    elements.detailPlaceholder?.classList.remove("hidden");
    elements.detailBody?.classList.add("hidden");
    if (elements.exportRepoJson) {
      elements.exportRepoJson.disabled = true;
    }
    if (elements.exportRepoCsv) {
      elements.exportRepoCsv.disabled = true;
    }
    renderLoadButtons();
    return;
  }

  ensureRepoLoadState(repo.id);
  const visibleIssues = getVisibleItems(repo, "issues");
  const visiblePrs = getVisibleItems(repo, "pullRequests");
  const visibleCommits = getVisibleItems(repo, "commits");

  elements.detailPlaceholder?.classList.add("hidden");
  elements.detailBody?.classList.remove("hidden");
  if (elements.exportRepoJson) {
    elements.exportRepoJson.disabled = false;
  }
  if (elements.exportRepoCsv) {
    elements.exportRepoCsv.disabled = false;
  }

  if (elements.detailTitle) {
    elements.detailTitle.textContent = repo.fullName;
  }
  if (elements.detailMeta) {
    elements.detailMeta.textContent = `${repo.role} access | ${repo.visibility} | default branch: ${repo.defaultBranch}`;
  }
  if (elements.detailLink) {
    elements.detailLink.href = repo.htmlUrl;
    elements.detailLink.classList.remove("hidden");
  }
  if (elements.topicBadges) {
    elements.topicBadges.innerHTML = (repo.topics.length ? repo.topics : ["no-topics"])
      .map((topic) => `<span class="badge">${escapeHtml(topic)}</span>`)
      .join("");
  }
  if (elements.detailIssueCount) {
    elements.detailIssueCount.textContent = String(visibleIssues.length);
  }
  if (elements.detailOpenPrCount) {
    elements.detailOpenPrCount.textContent = String(visiblePrs.filter((item) => item.state === "open").length);
  }
  if (elements.detailClosedPrCount) {
    elements.detailClosedPrCount.textContent = String(visiblePrs.filter((item) => item.state === "closed").length);
  }
  if (elements.detailCommitCount) {
    elements.detailCommitCount.textContent = String(visibleCommits.length);
  }
  if (elements.issueCountLabel) {
    elements.issueCountLabel.textContent = `${visibleIssues.length} visible issues`;
  }
  if (elements.prCountLabel) {
    elements.prCountLabel.textContent = `${visiblePrs.length} visible pull requests`;
  }
  if (elements.commitCountLabel) {
    elements.commitCountLabel.textContent = `${visibleCommits.length} visible commits`;
  }

  if (elements.issueList) {
    const issueItems = page === "dashboard" ? visibleIssues.slice(0, 4) : visibleIssues;
    elements.issueList.innerHTML = renderStackItems(
      issueItems,
      (issue) => `#${issue.number} ${issue.title}`,
      (issue) => `${issue.state} | ${issue.author} | updated ${formatDate(issue.updatedAt)}`,
      (issue) => issue.htmlUrl,
    );
  }

  if (elements.prList) {
    const prItems = page === "dashboard" ? visiblePrs.slice(0, 4) : visiblePrs;
    elements.prList.innerHTML = renderStackItems(
      prItems,
      (pr) => `#${pr.number} ${pr.title}`,
      (pr) => `${pr.state}${pr.mergedAt ? " | merged" : ""} | ${pr.author} | updated ${formatDate(pr.updatedAt)}`,
      (pr) => pr.htmlUrl,
    );
  }

  if (elements.commitList) {
    elements.commitList.innerHTML = renderStackItems(
      visibleCommits,
      (commit) => `${commit.shortSha} ${commit.message}`,
      (commit) => `${commit.author} | committed ${formatDate(commit.committedAt)}`,
      (commit) => commit.htmlUrl,
    );
  }

  renderTimeline(repo);
  renderLoadButtons();
}

function renderAuthState() {
  if (state.user) {
    elements.authSignedOut?.classList.add("hidden");
    elements.authSignedIn?.classList.remove("hidden");
    if (elements.userAvatar) {
      elements.userAvatar.src = state.user.avatarUrl;
    }
    if (elements.userName) {
      elements.userName.textContent = state.user.name || state.user.login;
    }
    if (elements.userLogin) {
      elements.userLogin.textContent = `@${state.user.login}`;
    }
    elements.loginButton?.classList.add("hidden");
    elements.syncButton?.classList.remove("hidden");
    elements.logoutButton?.classList.remove("hidden");
  } else {
    elements.authSignedOut?.classList.remove("hidden");
    elements.authSignedIn?.classList.add("hidden");
    elements.loginButton?.classList.remove("hidden");
    elements.syncButton?.classList.add("hidden");
    elements.logoutButton?.classList.add("hidden");
  }

  if (elements.loginButton) {
    elements.loginButton.disabled = !state.oauthReady;
    elements.loginButton.textContent = state.oauthReady ? "Sign in with GitHub" : "OAuth setup required";
  }
}

function renderCharts() {
  if (!elements.repoActivityChart || !elements.ownerDistributionChart) {
    return;
  }

  const repos = getVisibleRepos();
  if (!repos.length) {
    elements.repoActivityChart.className = "chart-panel empty-state";
    elements.ownerDistributionChart.className = "chart-panel empty-state";
    const message = state.user
      ? "Sync repositories to see activity charts."
      : "Sign in to view activity charts.";
    elements.repoActivityChart.textContent = message;
    elements.ownerDistributionChart.textContent = message;
    return;
  }

  const topRepos = [...repos]
    .sort((a, b) => b.issueCount + b.openPrCount - (a.issueCount + a.openPrCount))
    .slice(0, 6);
  const maxRepoValue = Math.max(...topRepos.map((repo) => repo.issueCount + repo.openPrCount), 1);

  elements.repoActivityChart.className = "chart-panel";
  elements.repoActivityChart.innerHTML = topRepos
    .map((repo) => {
      const total = repo.issueCount + repo.openPrCount;
      const width = Math.max(10, Math.round((total / maxRepoValue) * 100));
      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(repo.name)}</div>
          <div class="chart-track">
            <div class="chart-fill" style="width:${width}%"></div>
          </div>
          <div class="chart-value">${total}</div>
        </div>
      `;
    })
    .join("");

  const owners = Object.values(
    repos.reduce((accumulator, repo) => {
      const key = repo.owner || "unknown";
      accumulator[key] = accumulator[key] || { owner: key, count: 0 };
      accumulator[key].count += 1;
      return accumulator;
    }, {}),
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxOwnerValue = Math.max(...owners.map((owner) => owner.count), 1);

  elements.ownerDistributionChart.className = "chart-panel";
  elements.ownerDistributionChart.innerHTML = owners
    .map((owner) => {
      const width = Math.max(10, Math.round((owner.count / maxOwnerValue) * 100));
      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(owner.owner)}</div>
          <div class="chart-track">
            <div class="chart-fill secondary" style="width:${width}%"></div>
          </div>
          <div class="chart-value">${owner.count}</div>
        </div>
      `;
    })
    .join("");
}

function renderExports() {
  if (!elements.exportPanel) {
    return;
  }

  const hasData = state.user && state.repos.length > 0;
  elements.exportPanel.classList.toggle("hidden", !hasData);
}

function renderCounts() {
  if (!elements.repoCount) {
    return;
  }

  const repoCount = getVisibleRepos().length;
  if (page === "dashboard") {
    elements.repoCount.textContent = String(repoCount);
  } else {
    elements.repoCount.textContent = `${repoCount} repos`;
  }
}

function renderTabState() {
  if (!elements.tabButtons.length) {
    return;
  }

  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });

  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === state.activeTab);
  });
}

function renderLoadButtons() {
  const repo = getSelectedRepo();
  if (!repo) {
    [elements.loadMoreIssues, elements.loadMorePrs, elements.loadMoreCommits].forEach((button) =>
      button?.classList.add("hidden"),
    );
    return;
  }

  const repoLoadState = ensureRepoLoadState(repo.id);
  const mapping = [
    { button: elements.loadMoreIssues, section: "issues", label: "Load more issues" },
    { button: elements.loadMorePrs, section: "pullRequests", label: "Load more pull requests" },
    { button: elements.loadMoreCommits, section: "commits", label: "Load more commits" },
  ];

  mapping.forEach(({ button, section, label }) => {
    if (!button) {
      return;
    }

    const sectionState = repoLoadState[section];
    button.classList.toggle("hidden", !sectionState?.hasMore);
    button.disabled = Boolean(sectionState?.loading);
    button.textContent = sectionState?.loading ? "Loading..." : label;
  });
}

function renderDateFilters() {
  if (elements.dateFrom) {
    elements.dateFrom.value = state.filters.from;
  }
  if (elements.dateTo) {
    elements.dateTo.value = state.filters.to;
  }
}

function renderStackItems(items, titleBuilder, metaBuilder, linkBuilder) {
  if (!items.length) {
    return '<div class="empty-state">No data returned for this section.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="list-item">
          <div class="list-topline">
            <h4>${escapeHtml(titleBuilder(item))}</h4>
            <a href="${linkBuilder(item)}" target="_blank" rel="noreferrer">Open</a>
          </div>
          <p>${escapeHtml(metaBuilder(item))}</p>
        </article>
      `,
    )
    .join("");
}

function render() {
  renderAuthState();
  renderMetrics();
  renderCounts();
  renderRepoList();
  renderGroupList();
  renderRepoPicker();
  renderDateFilters();
  renderRepoDetails();
  renderCharts();
  renderExports();
  renderTabState();
}

function formatDate(value, includeTime = false) {
  if (!value) {
    return "unknown";
  }

  const options = includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function exportJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(filename, blob);
}

function exportCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportAllDataAsCsv() {
  const rows = [
    ["Repository", "Role", "Visibility", "Visible Issues", "Visible Open PRs", "Visible Closed PRs", "Visible Commits"],
    ...state.repos.map((repo) => {
      const issues = getVisibleItems(repo, "issues");
      const prs = getVisibleItems(repo, "pullRequests");
      const commits = getVisibleItems(repo, "commits");
      return [
        repo.fullName,
        repo.role,
        repo.visibility,
        issues.length,
        prs.filter((item) => item.state === "open").length,
        prs.filter((item) => item.state === "closed").length,
        commits.length,
      ];
    }),
  ];
  exportCsv("gitrac-repository-summary.csv", rows);
}

function exportSelectedRepoCsv() {
  const repo = getSelectedRepo();
  if (!repo) {
    return;
  }

  const rows = [
    ["Repository", "SHA", "Author", "Message", "Committed At", "URL"],
    ...getVisibleItems(repo, "commits").map((commit) => [
      repo.fullName,
      commit.sha,
      commit.author,
      commit.message,
      commit.committedAt,
      commit.htmlUrl,
    ]),
  ];

  exportCsv(`${repo.name}-commit-history.csv`, rows);
}

function attachEvents() {
  elements.loginButton?.addEventListener("click", () => {
    window.location.href = "/auth/github";
  });

  elements.logoutButton?.addEventListener("click", logout);
  elements.syncButton?.addEventListener("click", syncData);
  elements.clearButton?.addEventListener("click", () => {
    clearSavedState();
    render();
    setStatus("Saved dashboard data cleared from this browser.", "success");
  });
  elements.clearDateFilters?.addEventListener("click", () => {
    state.filters.from = "";
    state.filters.to = "";
    render();
  });

  [elements.searchInput, elements.roleFilter, elements.sortFilter]
    .filter(Boolean)
    .forEach((element) => {
      element.addEventListener("input", renderRepoList);
      element.addEventListener("change", renderRepoList);
    });

  [elements.dateFrom, elements.dateTo]
    .filter(Boolean)
    .forEach((element) => {
      element.addEventListener("change", () => {
        state.filters.from = elements.dateFrom?.value || "";
        state.filters.to = elements.dateTo?.value || "";
        render();
      });
    });

  elements.repoPicker?.addEventListener("change", (event) => {
    const nextId = Number(event.target.value);
    state.selectedRepoId = Number.isNaN(nextId) ? null : nextId;
    persistState();
    render();
  });

  elements.exportAllJson?.addEventListener("click", () => {
    exportJson("gitrac-dashboard-export.json", {
      exportedAt: new Date().toISOString(),
      user: state.user,
      dateFilter: state.filters,
      repositoryCount: state.repos.length,
      repositories: state.repos,
    });
  });

  elements.exportAllCsv?.addEventListener("click", exportAllDataAsCsv);

  elements.exportRepoJson?.addEventListener("click", () => {
    const repo = getSelectedRepo();
    if (repo) {
      exportJson(`${repo.name}-snapshot.json`, repo);
    }
  });

  elements.exportRepoCsv?.addEventListener("click", exportSelectedRepoCsv);
  elements.loadMoreIssues?.addEventListener("click", () => loadMoreSection("issues"));
  elements.loadMorePrs?.addEventListener("click", () => loadMoreSection("pullRequests"));
  elements.loadMoreCommits?.addEventListener("click", () => loadMoreSection("commits"));

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      renderTabState();
    });
  });
}

attachEvents();
initializeApp();
