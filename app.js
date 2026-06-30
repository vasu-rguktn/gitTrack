const STORAGE_KEY = "gitrac-dashboard-state";
const LOAD_MORE_PAGE_SIZE = 20;
const AUTO_REFRESH_MS = 1000 * 60 * 5;

const state = {
  user: null,
  authResolved: false,
  oauthReady: false,
  missingEnv: [],
  repositories: [],
  students: [],
  organizations: [],
  dashboard: null,
  searchIndex: [],
  selectedRepoId: null,
  lastSyncedAt: null,
  activeTab: "overview",
  autoRefreshTimer: null,
  filters: {
    search: "",
    organization: "all",
    section: "all",
    faculty: "all",
    visibility: "all",
    activity: "all",
    workflow: "all",
    archived: "all",
    sort: "activity",
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
  applyDateFilters: document.querySelector("#applyDateFilters"),
  statusMessage: document.querySelector("#statusMessage"),
  authSignedOut: document.querySelector("#authSignedOut"),
  authSignedIn: document.querySelector("#authSignedIn"),
  userAvatar: document.querySelector("#userAvatar"),
  userName: document.querySelector("#userName"),
  userLogin: document.querySelector("#userLogin"),
  connectedOrgsBadge: document.querySelector("#connectedOrgsBadge"),
  trackedReposBadge: document.querySelector("#trackedReposBadge"),
  lastSyncBadge: document.querySelector("#lastSyncBadge"),
  exportPanel: document.querySelector("#exportPanel"),
  exportAllJson: document.querySelector("#exportAllJson"),
  exportAllCsv: document.querySelector("#exportAllCsv"),
  exportRepoJson: document.querySelector("#exportRepoJson"),
  exportRepoCsv: document.querySelector("#exportRepoCsv"),
  repoCount: document.querySelector("#repoCount"),
  metricRepos: document.querySelector("#metricRepos"),
  metricIssues: document.querySelector("#metricIssues"),
  metricOpenPrs: document.querySelector("#metricOpenPrs"),
  metricClosedPrs: document.querySelector("#metricClosedPrs"),
  summaryExtraCards: document.querySelector("#summaryExtraCards"),
  searchInput: document.querySelector("#searchInput"),
  orgFilter: document.querySelector("#orgFilter"),
  sectionFilter: document.querySelector("#sectionFilter"),
  facultyFilter: document.querySelector("#facultyFilter"),
  visibilityFilter: document.querySelector("#visibilityFilter"),
  activityFilter: document.querySelector("#activityFilter"),
  workflowFilter: document.querySelector("#workflowFilter"),
  archivedFilter: document.querySelector("#archivedFilter"),
  sortFilter: document.querySelector("#sortFilter"),
  dateFrom: document.querySelector("#dateFrom"),
  dateTo: document.querySelector("#dateTo"),
  dateRangeSummary: document.querySelector("#dateRangeSummary"),
  repoSummary: document.querySelector("#repoSummary"),
  repoTable: document.querySelector("#repoTable"),
  alertRail: document.querySelector("#alertRail"),
  groupList: document.querySelector("#groupList"),
  studentList: document.querySelector("#studentList"),
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
  detailCommitToday: document.querySelector("#detailCommitToday"),
  detailCommitCount: document.querySelector("#detailCommitCount"),
  detailConflictCount: document.querySelector("#detailConflictCount"),
  detailWorkflowStatus: document.querySelector("#detailWorkflowStatus"),
  issueCountLabel: document.querySelector("#issueCountLabel"),
  prCountLabel: document.querySelector("#prCountLabel"),
  commitCountLabel: document.querySelector("#commitCountLabel"),
  timelineCountLabel: document.querySelector("#timelineCountLabel"),
  timelineList: document.querySelector("#timelineList"),
  issueList: document.querySelector("#issueList"),
  prList: document.querySelector("#prList"),
  commitList: document.querySelector("#commitList"),
  riskBadge: document.querySelector("#riskBadge"),
  riskList: document.querySelector("#riskList"),
  contributorList: document.querySelector("#contributorList"),
  branchList: document.querySelector("#branchList"),
  workflowList: document.querySelector("#workflowList"),
  openActivityPage: document.querySelector("#openActivityPage"),
  detailPlaceholder: document.querySelector("#detailPlaceholder"),
  detailBody: document.querySelector("#detailBody"),
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

function setStatus(message, variant = "idle") {
  if (!elements.statusMessage) {
    return;
  }
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status ${variant}`;
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

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      repositories: state.repositories,
      students: state.students,
      organizations: state.organizations,
      dashboard: state.dashboard,
      searchIndex: state.searchIndex,
      selectedRepoId: state.selectedRepoId,
      lastSyncedAt: state.lastSyncedAt,
      loadState: state.loadState,
    }),
  );
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const saved = JSON.parse(raw);
    state.repositories = Array.isArray(saved.repositories) ? saved.repositories : [];
    state.students = Array.isArray(saved.students) ? saved.students : [];
    state.organizations = Array.isArray(saved.organizations) ? saved.organizations : [];
    state.dashboard = saved.dashboard || null;
    state.searchIndex = Array.isArray(saved.searchIndex) ? saved.searchIndex : [];
    state.selectedRepoId = saved.selectedRepoId || state.repositories[0]?.id || null;
    state.lastSyncedAt = saved.lastSyncedAt || null;
    state.loadState = saved.loadState || {};
  } catch (error) {
    console.warn("Unable to restore saved dashboard state", error);
  }
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
  state.repositories = [];
  state.students = [];
  state.organizations = [];
  state.dashboard = null;
  state.searchIndex = [];
  state.selectedRepoId = null;
  state.lastSyncedAt = null;
  state.loadState = {};
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
    const error = new Error(payload.message || `Request failed with ${response.status}`);
    error.code = payload.code;
    throw error;
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

function formatDate(value, includeTime = false) {
  if (!value) {
    return "unknown";
  }

  const options = includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function hasDateFilter() {
  return Boolean(state.filters.from || state.filters.to);
}

function describeDateFilter() {
  if (!hasDateFilter()) {
    return "Showing all available activity for the selected repository.";
  }
  if (state.filters.from && state.filters.to) {
    return `Showing activity from ${formatDate(state.filters.from)} to ${formatDate(state.filters.to)}.`;
  }
  if (state.filters.from) {
    return `Showing activity from ${formatDate(state.filters.from)} onward.`;
  }
  return `Showing activity up to ${formatDate(state.filters.to)}.`;
}

function describeVisibleRangeResult(repo, visibleIssues, visiblePrs, visibleCommits) {
  if (!repo) {
    return describeDateFilter();
  }
  return `${describeDateFilter()} Visible results: ${visibleCommits.length} commits, ${visiblePrs.length} pull requests, ${visibleIssues.length} issues.`;
}

function daysSince(value) {
  if (!value) {
    return null;
  }
  const diff = Date.now() - new Date(value).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function handleAuthFailure(error) {
  if (error.code === "reauth_required") {
    state.user = null;
    clearSavedState();
    render();
    setStatus("GitHub authorization expired or was revoked. Sign in again to continue.", "error");
    return true;
  }
  return false;
}

function handleUrlMessage() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) {
    setStatus(`GitHub sign-in failed: ${error}`, "error");
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

async function loadDashboardData({ forceSync = false } = {}) {
  if (!state.user) {
    return;
  }

  const endpoint = forceSync ? "/api/sync" : "/api/dashboard";
  const message = forceSync ? "Refreshing live GitHub analytics..." : "Loading saved GitHub analytics...";
  setStatus(message, "loading");
  if (elements.syncButton) {
    elements.syncButton.disabled = true;
  }

  try {
    const payload = await apiFetch(endpoint);
    state.repositories = payload.repositories || [];
    state.students = payload.students || [];
    state.organizations = payload.organizations || [];
    state.dashboard = payload.dashboard || null;
    state.searchIndex = payload.searchIndex || [];
    state.lastSyncedAt = payload.syncedAt || null;
    state.selectedRepoId = pickSelectedRepoId();
    state.loadState = {};
    state.repositories.forEach((repo) => ensureRepoLoadState(repo.id));
    persistState();
    render();
    setStatus(`Dashboard ready. Loaded ${payload.repositoryCount} repositories.`, "success");
  } catch (error) {
    if (!handleAuthFailure(error)) {
      setStatus(error.message || "Could not load dashboard data.", "error");
    }
  } finally {
    if (elements.syncButton) {
      elements.syncButton.disabled = false;
    }
  }
}

function pickSelectedRepoId() {
  if (!state.repositories.length) {
    return null;
  }
  const exists = state.repositories.some((repo) => repo.id === state.selectedRepoId);
  if (exists) {
    return state.selectedRepoId;
  }

  const urlRepoId = Number(new URLSearchParams(window.location.search).get("repo"));
  if (urlRepoId && state.repositories.some((repo) => repo.id === urlRepoId)) {
    return urlRepoId;
  }

  return state.repositories[0].id;
}

function initializeAutoRefresh() {
  clearInterval(state.autoRefreshTimer);
  if (!state.user) {
    return;
  }
  state.autoRefreshTimer = window.setInterval(() => {
    loadDashboardData().catch(() => {});
  }, AUTO_REFRESH_MS);
}

async function initializeApp() {
  loadState();
  hydrateInitialFilterValues();
  render();

  try {
    await loadConfig();
    await loadAuthStatus();
    handleUrlMessage();
    render();

    if (!state.oauthReady) {
      setStatus(`OAuth setup needed: ${state.missingEnv.join(", ")}`, "error");
      return;
    }

    if (!state.user) {
      setStatus("Sign in with GitHub to load organization, repository, and student analytics.", "idle");
      return;
    }

    setStatus(`Signed in as ${state.user.login}. Loading analytics.`, "success");
    await loadDashboardData();
    initializeAutoRefresh();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not initialize the dashboard.", "error");
  }
}

async function syncData() {
  await loadDashboardData({ forceSync: true });
}

async function logout() {
  try {
    await apiFetch("/api/logout", { method: "POST" });
    clearSavedState();
    state.user = null;
    state.authResolved = true;
    render();
    setStatus("Signed out. Local dashboard state was cleared.", "success");
  } catch (error) {
    setStatus(error.message || "Could not sign out.", "error");
  }
}

function hydrateInitialFilterValues() {
  state.filters.search = elements.searchInput?.value || "";
  state.filters.organization = elements.orgFilter?.value || "all";
  state.filters.section = elements.sectionFilter?.value || "all";
  state.filters.faculty = elements.facultyFilter?.value || "all";
  state.filters.visibility = elements.visibilityFilter?.value || "all";
  state.filters.activity = elements.activityFilter?.value || "all";
  state.filters.workflow = elements.workflowFilter?.value || "all";
  state.filters.archived = elements.archivedFilter?.value || "all";
  state.filters.sort = elements.sortFilter?.value || "activity";
  state.filters.from = elements.dateFrom?.value || "";
  state.filters.to = elements.dateTo?.value || "";
}

function updateFilterOptions() {
  const fillSelect = (element, values, label) => {
    if (!element) {
      return;
    }
    const selected = element.value || "all";
    const options = [
      `<option value="all">All ${label}</option>`,
      ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ];
    element.innerHTML = options.join("");
    element.value = values.includes(selected) ? selected : "all";
  };

  fillSelect(elements.orgFilter, [...new Set(state.repositories.map((repo) => repo.organization))].sort(), "organizations");
  fillSelect(
    elements.sectionFilter,
    [...new Set(state.repositories.map((repo) => repo.section).filter((value) => value && value !== "Unassigned"))].sort(),
    "sections",
  );
  fillSelect(
    elements.facultyFilter,
    [...new Set(state.repositories.map((repo) => repo.faculty).filter((value) => value && value !== "Unassigned"))].sort(),
    "faculty",
  );
}

function matchesSearch(repo) {
  if (!state.filters.search) {
    return true;
  }
  const query = state.filters.search.toLowerCase();
  return state.searchIndex.some((entry) => entry.repoId === repo.id && (entry.searchText || "").includes(query));
}

function getFilteredRepositories() {
  let repositories = [...state.repositories];

  repositories = repositories.filter((repo) => matchesSearch(repo));

  if (state.filters.organization !== "all") {
    repositories = repositories.filter((repo) => repo.organization === state.filters.organization);
  }
  if (state.filters.section !== "all") {
    repositories = repositories.filter((repo) => repo.section === state.filters.section);
  }
  if (state.filters.faculty !== "all") {
    repositories = repositories.filter((repo) => repo.faculty === state.filters.faculty);
  }
  if (state.filters.visibility !== "all") {
    repositories = repositories.filter((repo) => repo.visibility === state.filters.visibility);
  }
  if (state.filters.activity !== "all") {
    repositories = repositories.filter((repo) => repo.activityStatus === state.filters.activity);
  }
  if (state.filters.workflow !== "all") {
    repositories = repositories.filter((repo) => repo.workflowStatus === state.filters.workflow);
  }
  if (state.filters.archived === "active") {
    repositories = repositories.filter((repo) => !repo.isArchived);
  }
  if (state.filters.archived === "archived") {
    repositories = repositories.filter((repo) => repo.isArchived);
  }

  const sorters = {
    activity: (left, right) => new Date(right.lastCommitAt) - new Date(left.lastCommitAt),
    name: (left, right) => left.fullName.localeCompare(right.fullName),
    commits: (left, right) => right.commitWeekCount - left.commitWeekCount,
    issues: (left, right) => right.openIssueCount - left.openIssueCount,
    prs: (left, right) => right.openPrCount - left.openPrCount,
  };

  return repositories.sort(sorters[state.filters.sort] || sorters.activity);
}

function getSelectedRepo() {
  return state.repositories.find((repo) => repo.id === state.selectedRepoId) || null;
}

function dateValueFromItem(section, item) {
  if (section === "issues" || section === "pullRequests") {
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
  return (repo[section] || []).filter((item) => isWithinDateRange(dateValueFromItem(section, item)));
}

function updateSelectedRepo(updater) {
  const index = state.repositories.findIndex((repo) => repo.id === state.selectedRepoId);
  if (index === -1) {
    return;
  }
  const nextRepo = updater(state.repositories[index]);
  state.repositories.splice(index, 1, nextRepo);
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

    const key = section === "commits" ? "sha" : "id";
    updateSelectedRepo((currentRepo) => {
      const mergedItems = [...currentRepo[section], ...payload.items].filter(
        (item, index, items) => items.findIndex((candidate) => candidate[key] === item[key]) === index,
      );
      return {
        ...currentRepo,
        [section]: mergedItems,
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
    if (!handleAuthFailure(error)) {
      setStatus(error.message || `Could not load more ${section}.`, "error");
    }
  }
}

function renderAuthState() {
  if (state.user) {
    elements.authSignedOut?.classList.add("hidden");
    elements.authSignedIn?.classList.remove("hidden");
    elements.loginButton?.classList.add("hidden");
    elements.syncButton?.classList.remove("hidden");
    elements.logoutButton?.classList.remove("hidden");
    if (elements.userAvatar) {
      elements.userAvatar.src = state.user.avatarUrl;
    }
    if (elements.userName) {
      elements.userName.textContent = state.user.name || state.user.login;
    }
    if (elements.userLogin) {
      elements.userLogin.textContent = `@${state.user.login}`;
    }
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
  if (elements.connectedOrgsBadge) {
    elements.connectedOrgsBadge.textContent = `${state.dashboard?.summary?.organizationsConnected || 0} orgs`;
  }
  if (elements.trackedReposBadge) {
    elements.trackedReposBadge.textContent = `${state.repositories.length} repos`;
  }
  if (elements.lastSyncBadge) {
    elements.lastSyncBadge.textContent = state.lastSyncedAt ? `Synced ${formatDate(state.lastSyncedAt, true)}` : "Not synced";
  }
}

function renderMetrics() {
  const summary = state.dashboard?.summary;
  if (!summary || !elements.metricRepos) {
    elements.metricRepos && (elements.metricRepos.textContent = "0");
    elements.metricIssues && (elements.metricIssues.textContent = "0");
    elements.metricOpenPrs && (elements.metricOpenPrs.textContent = "0");
    elements.metricClosedPrs && (elements.metricClosedPrs.textContent = "0");
    return;
  }

  elements.metricRepos.textContent = String(summary.totalRepositories || 0);
  elements.metricIssues.textContent = String(summary.openIssues || 0);
  elements.metricOpenPrs.textContent = String(summary.openPullRequests || 0);
  elements.metricClosedPrs.textContent = String(summary.mergedPullRequests || 0);

  if (!elements.summaryExtraCards || page !== "dashboard") {
    return;
  }

  const cards = [
    ["Repositories active today", summary.activeToday],
    ["Inactive over 7 days", summary.inactive7Days],
    ["Inactive over 30 days", summary.inactive30Days],
    ["Commits today", summary.commitsToday],
    ["Commits this week", summary.commitsWeek],
    ["Students active today", summary.studentsActiveToday],
    ["Students inactive", summary.studentsInactive],
    ["Pending reviews", summary.pendingReviews],
    ["Failed workflows", summary.failedWorkflows],
    ["Successful workflows", summary.successfulWorkflows],
    ["Repositories with conflicts", summary.repositoriesWithConflicts],
    ["Connected organizations", summary.organizationsConnected],
  ];

  elements.summaryExtraCards.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card panel mini-metric">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>Live from the latest sync</small>
        </article>
      `,
    )
    .join("");
}

function renderAlerts() {
  if (!elements.alertRail) {
    return;
  }

  const repositories = getFilteredRepositories();
  if (!repositories.length) {
    elements.alertRail.className = "alert-rail empty-state compact-empty";
    elements.alertRail.textContent = state.user
      ? "No repositories match the current filters."
      : "Sign in to surface review and workflow alerts.";
    return;
  }

  const alerts = [];
  repositories.filter((repo) => repo.activityStatus === "inactive-30").slice(0, 2).forEach((repo) => {
    alerts.push({ tone: "muted", label: "Inactive 30d", text: `${repo.fullName} has no recent commits in over 30 days.` });
  });
  repositories.filter((repo) => repo.workflowStatus === "failure").slice(0, 2).forEach((repo) => {
    alerts.push({ tone: "danger", label: "Workflow failed", text: `${repo.fullName} has a failing workflow run.` });
  });
  repositories.filter((repo) => repo.pendingReviews > 0).slice(0, 2).forEach((repo) => {
    alerts.push({ tone: "warning", label: "Pending reviews", text: `${repo.fullName} has ${repo.pendingReviews} PRs waiting for review.` });
  });
  repositories.filter((repo) => repo.mergeConflicts > 0).slice(0, 2).forEach((repo) => {
    alerts.push({ tone: "danger", label: "Merge conflicts", text: `${repo.fullName} has ${repo.mergeConflicts} conflicting pull requests.` });
  });

  if (!alerts.length) {
    elements.alertRail.className = "alert-rail empty-state compact-empty";
    elements.alertRail.textContent = "No high-priority alerts in the current filtered view.";
    return;
  }

  elements.alertRail.className = "alert-rail";
  elements.alertRail.innerHTML = alerts
    .map(
      (alert) => `
        <article class="alert-card ${alert.tone}">
          <strong>${escapeHtml(alert.label)}</strong>
          <p>${escapeHtml(alert.text)}</p>
        </article>
      `,
    )
    .join("");
}

function renderRepositoryTable() {
  if (!elements.repoTable) {
    return;
  }

  const repositories = getFilteredRepositories();
  if (elements.repoSummary) {
    elements.repoSummary.textContent = `${repositories.length} repositories shown`;
  }

  if (!repositories.length) {
    elements.repoTable.className = "data-table empty-state";
    elements.repoTable.textContent = state.user
      ? "No repositories match the current filters."
      : "Sign in and refresh your GitHub data to populate the repository table.";
    return;
  }

  elements.repoTable.className = "data-table";
  elements.repoTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Repository</th>
          <th>Owner</th>
          <th>Section</th>
          <th>Faculty</th>
          <th>Language</th>
          <th>Commits Today</th>
          <th>Commits Week</th>
          <th>Open Issues</th>
          <th>Open PRs</th>
          <th>Last Commit</th>
          <th>Workflow</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${repositories
          .map(
            (repo) => `
              <tr data-repo-id="${repo.id}" class="${repo.id === state.selectedRepoId ? "active-row" : ""}">
                <td>
                  <div class="table-title">${escapeHtml(repo.fullName)}</div>
                  <div class="table-meta">${escapeHtml(repo.visibility)} · ${escapeHtml(repo.activityStatus)}</div>
                </td>
                <td>${escapeHtml(repo.owner)}</td>
                <td>${escapeHtml(repo.section)}</td>
                <td>${escapeHtml(repo.faculty)}</td>
                <td>${escapeHtml(repo.primaryLanguage)}</td>
                <td>${repo.commitTodayCount}</td>
                <td>${repo.commitWeekCount}</td>
                <td>${repo.openIssueCount}</td>
                <td>${repo.openPrCount}</td>
                <td>${escapeHtml(formatDate(repo.lastCommitAt, true))}<div class="table-meta">${escapeHtml(repo.lastContributor || "unknown")}</div></td>
                <td><span class="badge workflow-${escapeHtml(repo.workflowStatus)}">${escapeHtml(repo.workflowStatus)}</span></td>
                <td><button class="ghost table-action" type="button" data-action="open">Review</button></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  elements.repoTable.querySelectorAll("tbody tr").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("[data-action='open']")) {
        window.location.href = `./activity.html?repo=${row.dataset.repoId}`;
        return;
      }
      state.selectedRepoId = Number(row.dataset.repoId);
      persistState();
      render();
    });
  });
}

function renderRepoPicker() {
  if (!elements.repoPicker) {
    return;
  }

  if (!state.repositories.length) {
    elements.repoPicker.innerHTML = '<option value="">No synced repositories</option>';
    elements.repoPicker.disabled = true;
    return;
  }

  elements.repoPicker.disabled = false;
  elements.repoPicker.innerHTML = state.repositories
    .map(
      (repo) =>
        `<option value="${repo.id}" ${repo.id === state.selectedRepoId ? "selected" : ""}>${escapeHtml(repo.fullName)}</option>`,
    )
    .join("");
}

function buildRiskSignals(repo) {
  const signals = [];

  if (repo.activityStatus === "inactive-30") {
    signals.push(`No commits for ${daysSince(repo.lastCommitAt)} days.`);
  } else if (repo.activityStatus === "inactive-7") {
    signals.push(`No commits for ${daysSince(repo.lastCommitAt)} days.`);
  }
  if (repo.pendingReviews > 0) {
    signals.push(`${repo.pendingReviews} pull requests are waiting for review.`);
  }
  if (repo.mergeConflicts > 0) {
    signals.push(`${repo.mergeConflicts} pull requests have merge conflicts.`);
  }
  if (repo.workflowStatus === "failure") {
    signals.push("Latest workflow run failed.");
  }
  if (repo.tinyCommitCount >= 5) {
    signals.push(`${repo.tinyCommitCount} recent commits were tiny changes.`);
  }
  if (repo.lateCommitCount >= 3) {
    signals.push(`${repo.lateCommitCount} recent commits were pushed late at night.`);
  }
  if (!signals.length) {
    signals.push("No major risk signals in the latest sync.");
  }

  return signals;
}

function renderStackItems(items, titleBuilder, metaBuilder, linkBuilder) {
  if (!items.length) {
    return '<div class="empty-state compact-empty">No data returned for this section.</div>';
  }

  return items
    .map(
      (item) => `
        <article class="list-item">
          <div class="list-topline">
            <h4>${escapeHtml(titleBuilder(item))}</h4>
            ${linkBuilder(item) ? `<a href="${linkBuilder(item)}" target="_blank" rel="noreferrer">Open</a>` : ""}
          </div>
          <p>${escapeHtml(metaBuilder(item))}</p>
        </article>
      `,
    )
    .join("");
}

function renderRepoDetails() {
  const repo = getSelectedRepo();
  if (!repo) {
    elements.detailPlaceholder?.classList.remove("hidden");
    elements.detailBody?.classList.add("hidden");
    elements.detailLink?.classList.add("hidden");
    if (elements.exportRepoJson) {
      elements.exportRepoJson.disabled = true;
    }
    if (elements.exportRepoCsv) {
      elements.exportRepoCsv.disabled = true;
    }
    return;
  }

  ensureRepoLoadState(repo.id);
  const visibleIssues = getVisibleItems(repo, "issues");
  const visiblePrs = getVisibleItems(repo, "pullRequests");
  const visibleCommits = getVisibleItems(repo, "commits");
  const riskSignals = buildRiskSignals(repo);

  elements.detailPlaceholder?.classList.add("hidden");
  elements.detailBody?.classList.remove("hidden");
  elements.detailTitle && (elements.detailTitle.textContent = repo.fullName);
  elements.detailMeta &&
    (elements.detailMeta.textContent = `${repo.organization} · ${repo.section} · ${repo.faculty} · ${repo.visibility} · branch ${repo.defaultBranch}`);
  if (elements.detailLink) {
    elements.detailLink.href = repo.htmlUrl;
    elements.detailLink.classList.remove("hidden");
  }
  if (elements.openActivityPage) {
    elements.openActivityPage.href = `./activity.html?repo=${repo.id}`;
  }
  if (elements.topicBadges) {
    const badges = [
      repo.primaryLanguage,
      repo.workflowStatus,
      repo.isArchived ? "archived" : "active",
      ...repo.topics.slice(0, 6),
    ];
    elements.topicBadges.innerHTML = badges.map((topic) => `<span class="badge">${escapeHtml(topic)}</span>`).join("");
  }
  elements.detailCommitToday && (elements.detailCommitToday.textContent = String(repo.commitTodayCount || 0));
  elements.detailCommitCount && (elements.detailCommitCount.textContent = String(repo.commitWeekCount || 0));
  elements.detailIssueCount && (elements.detailIssueCount.textContent = String(repo.openIssueCount ?? 0));
  elements.detailOpenPrCount && (elements.detailOpenPrCount.textContent = String(repo.openPrCount || 0));
  elements.detailConflictCount && (elements.detailConflictCount.textContent = String(repo.mergeConflicts || 0));
  elements.detailWorkflowStatus && (elements.detailWorkflowStatus.textContent = String(repo.workflowStatus || "unknown"));
  elements.detailClosedPrCount && (elements.detailClosedPrCount.textContent = String(repo.mergedPrCount || 0));
  elements.issueCountLabel && (elements.issueCountLabel.textContent = `${visibleIssues.length} visible issues`);
  elements.prCountLabel && (elements.prCountLabel.textContent = `${visiblePrs.length} visible pull requests`);
  elements.commitCountLabel && (elements.commitCountLabel.textContent = `${visibleCommits.length} visible commits`);
  elements.riskBadge && (elements.riskBadge.textContent = `${riskSignals.length} signals`);
  if (elements.dateRangeSummary && page === "activity") {
    elements.dateRangeSummary.textContent = describeVisibleRangeResult(repo, visibleIssues, visiblePrs, visibleCommits);
  }

  if (elements.riskList) {
    elements.riskList.innerHTML = renderStackItems(
      riskSignals.map((signal, index) => ({ id: index, text: signal })),
      () => "Repository signal",
      (item) => item.text,
      () => "",
    );
  }
  if (elements.prList) {
    elements.prList.innerHTML = renderStackItems(
      page === "dashboard" ? visiblePrs.slice(0, 4) : visiblePrs,
      (pr) => `#${pr.number} ${pr.title}`,
      (pr) => `${pr.state}${pr.isDraft ? " · draft" : ""} · ${pr.author} · ${formatDate(pr.updatedAt, true)}`,
      (pr) => pr.htmlUrl,
    );
  }
  if (elements.commitList) {
    elements.commitList.innerHTML = renderStackItems(
      page === "dashboard" ? visibleCommits.slice(0, 4) : visibleCommits,
      (commit) => `${commit.shortSha} ${commit.message}`,
      (commit) => `${commit.author} · ${formatDate(commit.committedAt, true)} · +${commit.additions || 0}/-${commit.deletions || 0}`,
      (commit) => commit.htmlUrl,
    );
  }
  if (elements.issueList) {
    elements.issueList.innerHTML = renderStackItems(
      visibleIssues,
      (issue) => `#${issue.number} ${issue.title}`,
      (issue) => `${issue.state} · ${issue.author} · ${formatDate(issue.updatedAt, true)}`,
      (issue) => issue.htmlUrl,
    );
  }
  if (elements.contributorList) {
    elements.contributorList.innerHTML = renderStackItems(
      (repo.contributors || []).slice(0, 8),
      (contributor) => contributor.name,
      (contributor) => contributor.login || "GitHub user",
      () => "",
    );
  }
  if (elements.branchList) {
    elements.branchList.innerHTML = renderStackItems(
      repo.branches || [],
      (branch) => branch.name,
      (branch) => branch.protected ? "Protected branch" : "Standard branch",
      () => "",
    );
  }
  if (elements.workflowList) {
    elements.workflowList.innerHTML = renderStackItems(
      repo.workflowRuns || [],
      (run) => run.name,
      (run) => `${run.conclusion || run.status} · ${run.branch} · ${formatDate(run.updatedAt, true)}`,
      (run) => run.htmlUrl,
    );
  }

  renderTimeline(repo);
  renderLoadButtons();
  if (elements.exportRepoJson) {
    elements.exportRepoJson.disabled = false;
  }
  if (elements.exportRepoCsv) {
    elements.exportRepoCsv.disabled = false;
  }
}

function renderTimeline(repo) {
  if (!elements.timelineList) {
    return;
  }

  const items = [
    ...getVisibleItems(repo, "issues").map((issue) => ({
      type: "Issue",
      title: `#${issue.number} ${issue.title}`,
      meta: `${issue.state} · ${issue.author} · ${formatDate(issue.updatedAt, true)}`,
      url: issue.htmlUrl,
      date: issue.updatedAt || issue.createdAt,
    })),
    ...getVisibleItems(repo, "pullRequests").map((pr) => ({
      type: pr.mergedAt ? "PR merged" : "PR",
      title: `#${pr.number} ${pr.title}`,
      meta: `${pr.state}${pr.isDraft ? " · draft" : ""} · ${pr.author} · ${formatDate(pr.updatedAt, true)}`,
      url: pr.htmlUrl,
      date: pr.updatedAt || pr.createdAt,
    })),
    ...getVisibleItems(repo, "commits").map((commit) => ({
      type: "Commit",
      title: `${commit.shortSha} ${commit.message}`,
      meta: `${commit.author} · ${formatDate(commit.committedAt, true)}`,
      url: commit.htmlUrl,
      date: commit.committedAt,
    })),
    ...(repo.workflowRuns || []).map((run) => ({
      type: "Workflow",
      title: run.name,
      meta: `${run.conclusion || run.status} · ${run.branch} · ${formatDate(run.updatedAt, true)}`,
      url: run.htmlUrl,
      date: run.updatedAt,
    })),
  ].sort((left, right) => new Date(right.date) - new Date(left.date));

  elements.timelineList.innerHTML = renderStackItems(
    items,
    (item) => `${item.type} · ${item.title}`,
    (item) => item.meta,
    (item) => item.url,
  );

  if (elements.timelineCountLabel) {
    elements.timelineCountLabel.textContent = `${items.length} visible items`;
  }
}

function renderStudents() {
  if (!elements.studentList) {
    return;
  }

  const students = state.students.slice(0, 12);
  if (!students.length) {
    elements.studentList.className = "stack-list empty-state";
    elements.studentList.textContent = state.user
      ? "No commit activity was available to derive student analytics."
      : "Sign in to compute student activity.";
    return;
  }

  elements.studentList.className = "stack-list";
  elements.studentList.innerHTML = students
    .map(
      (student) => `
        <article class="list-item">
          <div class="list-topline">
            <h4>${escapeHtml(student.name)}</h4>
            <span class="badge">${student.commitCount} commits</span>
          </div>
          <p>${escapeHtml(student.section)} · ${escapeHtml(student.faculty)} · ${student.repositoryCount} repos · last active ${escapeHtml(formatDate(student.lastActivity, true))}</p>
        </article>
      `,
    )
    .join("");
}

function renderDashboardTimeline() {
  if (!elements.timelineList || page !== "dashboard") {
    return;
  }

  const feed = state.dashboard?.activityFeed || [];
  if (!feed.length) {
    elements.timelineList.className = "stack-list empty-state";
    elements.timelineList.textContent = state.user
      ? "No recent feed items are available yet."
      : "Sign in to view live activity.";
    return;
  }

  elements.timelineList.className = "stack-list";
  elements.timelineList.innerHTML = renderStackItems(
    feed,
    (item) => `${item.type} · ${item.repository}`,
    (item) => `${item.actor} · ${item.title} · ${formatDate(item.date, true)}`,
    (item) => item.url,
  );
}

function renderOrganizations() {
  if (!elements.groupList) {
    return;
  }

  const orgs = state.dashboard?.organizations || [];
  if (!orgs.length) {
    elements.groupList.className = "group-grid empty-state";
    elements.groupList.textContent = state.user
      ? "No organization rollups are available from the current GitHub access."
      : "Sign in to view organization-level analytics.";
    return;
  }

  elements.groupList.className = "group-grid";
  elements.groupList.innerHTML = orgs
    .map(
      (org) => `
        <article class="group-card">
          <div class="repo-title-row">
            <h3>${escapeHtml(org.login)}</h3>
            <span class="badge">${org.repositoryCount} repos</span>
          </div>
          <p>${org.studentCount} active students, ${org.openIssues} open issues, ${org.openPullRequests} open PRs.</p>
          <div class="badge-row">
            <span class="badge">${org.failedWorkflows} failed workflows</span>
            <a class="inline-link" href="${org.url}" target="_blank" rel="noreferrer">Open org</a>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderCharts() {
  if (!elements.repoActivityChart || !elements.ownerDistributionChart) {
    return;
  }

  if (!state.repositories.length) {
    const message = state.user ? "Refresh GitHub data to populate charts." : "Sign in to view live charts.";
    elements.repoActivityChart.className = "chart-panel empty-state";
    elements.repoActivityChart.textContent = message;
    elements.ownerDistributionChart.className = "chart-panel empty-state";
    elements.ownerDistributionChart.textContent = message;
    return;
  }

  const activeRepos = getFilteredRepositories().slice(0, 8);
  if (!activeRepos.length) {
    const message = "No repositories match the current filters.";
    elements.repoActivityChart.className = "chart-panel empty-state";
    elements.repoActivityChart.textContent = message;
    elements.ownerDistributionChart.className = "chart-panel empty-state";
    elements.ownerDistributionChart.textContent = message;
    return;
  }

  const maxCommitValue = Math.max(...activeRepos.map((repo) => repo.commitWeekCount), 1);
  elements.repoActivityChart.className = "chart-panel";
  elements.repoActivityChart.innerHTML = activeRepos
    .map(
      (repo) => `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(repo.name)}</div>
          <div class="chart-track"><div class="chart-fill" style="width:${Math.max(12, Math.round((repo.commitWeekCount / maxCommitValue) * 100))}%"></div></div>
          <div class="chart-value">${repo.commitWeekCount}</div>
        </div>
      `,
    )
    .join("");

  const organizations = Object.values(
    activeRepos.reduce((accumulator, repo) => {
      const key = repo.organization || "Personal";
      accumulator[key] = accumulator[key] || { login: key, repositoryCount: 0 };
      accumulator[key].repositoryCount += 1;
      return accumulator;
    }, {}),
  ).sort((left, right) => right.repositoryCount - left.repositoryCount || left.login.localeCompare(right.login));
  const maxOrgValue = Math.max(...organizations.map((org) => org.repositoryCount), 1);
  elements.ownerDistributionChart.className = "chart-panel";
  elements.ownerDistributionChart.innerHTML = organizations
    .map(
      (org) => `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(org.login)}</div>
          <div class="chart-track"><div class="chart-fill secondary" style="width:${Math.max(12, Math.round((org.repositoryCount / maxOrgValue) * 100))}%"></div></div>
          <div class="chart-value">${org.repositoryCount}</div>
        </div>
      `,
    )
    .join("");
}

function renderExports() {
  if (!elements.exportPanel) {
    return;
  }
  elements.exportPanel.classList.toggle("hidden", !(state.user && state.repositories.length));
}

function renderCounts() {
  if (!elements.repoCount) {
    return;
  }
  elements.repoCount.textContent = page === "dashboard" ? String(state.repositories.length) : `${state.repositories.length} repos`;
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
    [elements.loadMoreIssues, elements.loadMorePrs, elements.loadMoreCommits].forEach((button) => button?.classList.add("hidden"));
    return;
  }

  const repoLoadState = ensureRepoLoadState(repo.id);
  [
    { button: elements.loadMoreIssues, section: "issues", label: "Load more issues" },
    { button: elements.loadMorePrs, section: "pullRequests", label: "Load more pull requests" },
    { button: elements.loadMoreCommits, section: "commits", label: "Load more commits" },
  ].forEach(({ button, section, label }) => {
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
  if (elements.dateRangeSummary) {
    elements.dateRangeSummary.textContent = describeDateFilter();
  }
  if (elements.applyDateFilters) {
    elements.applyDateFilters.disabled = !state.selectedRepoId;
  }
}

function render() {
  updateFilterOptions();
  renderAuthState();
  renderMetrics();
  renderAlerts();
  renderRepositoryTable();
  renderRepoPicker();
  renderDateFilters();
  renderRepoDetails();
  renderStudents();
  renderDashboardTimeline();
  renderOrganizations();
  renderCharts();
  renderExports();
  renderCounts();
  renderTabState();
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(filename, blob);
}

function exportCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
}

function exportAllDataAsCsv() {
  const rows = [
    ["Repository", "Organization", "Section", "Faculty", "Visibility", "Commits Today", "Commits Week", "Open Issues", "Open PRs", "Pending Reviews", "Workflow", "Last Commit"],
    ...state.repositories.map((repo) => [
      repo.fullName,
      repo.organization,
      repo.section,
      repo.faculty,
      repo.visibility,
      repo.commitTodayCount,
      repo.commitWeekCount,
      repo.openIssueCount,
      repo.openPrCount,
      repo.pendingReviews,
      repo.workflowStatus,
      repo.lastCommitAt,
    ]),
  ];
  exportCsv("gitrac-repository-summary.csv", rows);
}

function exportSelectedRepoCsv() {
  const repo = getSelectedRepo();
  if (!repo) {
    return;
  }
  const rows = [
    ["Repository", "SHA", "Author", "Message", "Committed At", "Additions", "Deletions", "URL"],
    ...getVisibleItems(repo, "commits").map((commit) => [
      repo.fullName,
      commit.sha,
      commit.author,
      commit.message,
      commit.committedAt,
      commit.additions || 0,
      commit.deletions || 0,
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
    setStatus("Saved analytics state cleared from this browser.", "success");
  });
  elements.clearDateFilters?.addEventListener("click", () => {
    state.filters.from = "";
    state.filters.to = "";
    render();
    const repo = getSelectedRepo();
    const visibleIssues = repo ? getVisibleItems(repo, "issues") : [];
    const visiblePrs = repo ? getVisibleItems(repo, "pullRequests") : [];
    const visibleCommits = repo ? getVisibleItems(repo, "commits") : [];
    setStatus(describeVisibleRangeResult(repo, visibleIssues, visiblePrs, visibleCommits), "success");
  });
  elements.applyDateFilters?.addEventListener("click", () => {
    render();
    const repo = getSelectedRepo();
    const visibleIssues = repo ? getVisibleItems(repo, "issues") : [];
    const visiblePrs = repo ? getVisibleItems(repo, "pullRequests") : [];
    const visibleCommits = repo ? getVisibleItems(repo, "commits") : [];
    setStatus(describeVisibleRangeResult(repo, visibleIssues, visiblePrs, visibleCommits), "success");
  });

  const setFilter = (key, element) => {
    if (!element) {
      return;
    }
    const eventName = element.tagName === "SELECT" ? "change" : "input";
    element.addEventListener(eventName, () => {
      state.filters[key] = element.value.trim ? element.value.trim() : element.value;
      if (key === "search" && !state.filters[key]) {
        state.filters[key] = "";
      }
      render();
    });
  };

  setFilter("search", elements.searchInput);
  setFilter("organization", elements.orgFilter);
  setFilter("section", elements.sectionFilter);
  setFilter("faculty", elements.facultyFilter);
  setFilter("visibility", elements.visibilityFilter);
  setFilter("activity", elements.activityFilter);
  setFilter("workflow", elements.workflowFilter);
  setFilter("archived", elements.archivedFilter);
  setFilter("sort", elements.sortFilter);

  [elements.dateFrom, elements.dateTo]
    .filter(Boolean)
    .forEach((element) => {
      element.addEventListener("change", () => {
        state.filters.from = elements.dateFrom?.value || "";
        state.filters.to = elements.dateTo?.value || "";
        render();
        const repo = getSelectedRepo();
        const visibleIssues = repo ? getVisibleItems(repo, "issues") : [];
        const visiblePrs = repo ? getVisibleItems(repo, "pullRequests") : [];
        const visibleCommits = repo ? getVisibleItems(repo, "commits") : [];
        setStatus(describeVisibleRangeResult(repo, visibleIssues, visiblePrs, visibleCommits), "success");
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
      repositories: state.repositories,
      students: state.students,
      organizations: state.organizations,
      dashboard: state.dashboard,
      filters: state.filters,
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
