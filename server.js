const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const app = express();
const PORT = Number(process.env.PORT || 4173);
const MAX_REPOS = Number(process.env.MAX_REPOS || 40);
const MAX_ACTIVITY_ITEMS = Number(process.env.MAX_ACTIVITY_ITEMS || process.env.MAX_ITEMS || 20);
const ACTIVITY_PAGE_SIZE_LIMIT = 50;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 1000 * 60 * 5);
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 8);
const GRAPHQL_BATCH_SIZE = 8;

const requiredEnv = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
const repoCache = new Map();

// TODO: Persist sessions and cached GitHub snapshots in a shared store (Redis/database)
// before deploying multiple server instances behind a load balancer.

app.use(express.json());
app.use(
  session({
    name: "gitrac.sid",
    secret: process.env.SESSION_SECRET || "development-session-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_MS,
    },
  }),
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTokenExpired(sessionData) {
  if (!sessionData?.tokenExpiresAt) {
    return false;
  }
  return Date.now() >= sessionData.tokenExpiresAt - 60_000;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeGitHubError(detail, status) {
  if (status === 401) {
    return "GitHub authorization expired or was revoked.";
  }
  if (status === 403 && String(detail).toLowerCase().includes("rate limit")) {
    return "GitHub API rate limit reached. Please retry in a moment.";
  }
  return detail || `GitHub API request failed with ${status}`;
}

async function withRetry(task, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw lastError;
      }
      await sleep(250 * attempt);
    }
  }

  throw lastError;
}

function githubHeaders(accessToken) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "giTrac",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRest(pathname, accessToken, options = {}) {
  return withRetry(async () => {
    const response = await fetch(`https://api.github.com${pathname}`, {
      ...options,
      headers: {
        ...githubHeaders(accessToken),
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(normalizeGitHubError(detail, response.status));
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  });
}

async function githubGraphql(query, variables, accessToken) {
  return withRetry(async () => {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        ...githubHeaders(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const payload = await response.json();
    if (!response.ok || payload.errors?.length) {
      const detail = payload.errors?.map((item) => item.message).join("; ") || "GraphQL request failed.";
      const error = new Error(normalizeGitHubError(detail, response.status));
      error.status = response.status;
      throw error;
    }

    return payload.data;
  });
}

async function exchangeGithubToken(payload) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const tokenPayload = await response.json();
  if (!response.ok || tokenPayload.error) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || "Could not complete GitHub OAuth.");
  }

  return tokenPayload;
}

async function refreshGithubTokenIfNeeded(req) {
  if (!req.session?.accessToken) {
    return false;
  }

  if (!isTokenExpired(req.session)) {
    return true;
  }

  if (!req.session.refreshToken) {
    return true;
  }

  try {
    const tokenPayload = await exchangeGithubToken({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: req.session.refreshToken,
    });

    req.session.accessToken = tokenPayload.access_token;
    req.session.refreshToken = tokenPayload.refresh_token || req.session.refreshToken;
    req.session.tokenExpiresAt = tokenPayload.expires_in ? Date.now() + tokenPayload.expires_in * 1000 : null;
    return true;
  } catch (_error) {
    req.session.authError = "token_refresh_failed";
    return false;
  }
}

async function ensureAuthenticatedGithubSession(req, res, next) {
  if (!req.session?.accessToken) {
    return res.status(401).json({ message: "You are not signed in with GitHub.", code: "not_authenticated" });
  }

  const refreshed = await refreshGithubTokenIfNeeded(req);
  if (!refreshed) {
    return res.status(401).json({ message: "Your GitHub session expired. Please sign in again.", code: "reauth_required" });
  }

  try {
    const viewer = await githubRest("/user", req.session.accessToken);
    req.session.user = {
      login: viewer.login,
      name: viewer.name,
      avatarUrl: viewer.avatar_url,
      profileUrl: viewer.html_url,
    };
    return next();
  } catch (error) {
    if (error.status === 401) {
      req.session.authError = "token_invalid";
      return res.status(401).json({
        message: "GitHub authorization expired or permissions were revoked. Please sign in again.",
        code: "reauth_required",
      });
    }
    return res.status(502).json({ message: error.message || "Could not validate the GitHub session." });
  }
}

function extractMetadataFromTopics(topics = []) {
  const metadata = {
    section: "Unassigned",
    faculty: "Unassigned",
  };

  for (const topic of topics) {
    if (topic.startsWith("section-") || topic.startsWith("section:")) {
      metadata.section = topic.split(/[:-]/).slice(1).join(" ").replace(/\b\w/g, (match) => match.toUpperCase()) || metadata.section;
    }
    if (topic.startsWith("faculty-") || topic.startsWith("faculty:")) {
      metadata.faculty = topic.split(/[:-]/).slice(1).join(" ").replace(/\b\w/g, (match) => match.toUpperCase()) || metadata.faculty;
    }
  }

  return metadata;
}

function normalizeIssue(item) {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    state: item.state,
    author: item.user?.login || item.author?.login || "unknown",
    createdAt: item.created_at || item.createdAt,
    updatedAt: item.updated_at || item.updatedAt,
    htmlUrl: item.html_url || item.url,
  };
}

function normalizePull(item) {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    state: item.state.toLowerCase(),
    author: item.user?.login || item.author?.login || "unknown",
    createdAt: item.created_at || item.createdAt,
    updatedAt: item.updated_at || item.updatedAt,
    closedAt: item.closed_at || item.closedAt,
    mergedAt: item.merged_at || item.mergedAt,
    htmlUrl: item.html_url || item.url,
    reviewDecision: item.reviewDecision || "REVIEW_REQUIRED",
    mergeable: item.mergeable || "UNKNOWN",
    isDraft: Boolean(item.draft || item.isDraft),
    reviewRequests: item.reviewRequests?.nodes?.map((node) => node.requestedReviewer?.login).filter(Boolean) || [],
  };
}

function normalizeCommit(item) {
  const authorName = item.commit?.author?.name || item.author?.login || item.author?.name || "unknown";
  const committedAt = item.commit?.author?.date || item.committedDate;

  return {
    sha: item.sha || item.oid,
    shortSha: (item.sha || item.oid || "").slice(0, 7),
    message: item.commit?.message?.split("\n")[0] || item.messageHeadline || "No commit message",
    author: authorName,
    authorLogin: item.author?.login || item.author?.user?.login || null,
    committedAt,
    additions: item.stats?.additions || item.additions || 0,
    deletions: item.stats?.deletions || item.deletions || 0,
    changedFiles: item.files?.length || item.changedFiles || 0,
    htmlUrl: item.html_url || item.url,
  };
}

function normalizeWorkflowSummary(run) {
  return {
    id: run.id,
    name: run.name,
    branch: run.head_branch,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

function daysSince(value) {
  if (!value) {
    return null;
  }
  const diff = Date.now() - new Date(value).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getActivityStatus(lastCommitAt) {
  const days = daysSince(lastCommitAt);
  if (days == null) {
    return "unknown";
  }
  if (days === 0) {
    return "active-today";
  }
  if (days <= 7) {
    return "active-week";
  }
  if (days <= 30) {
    return "inactive-7";
  }
  return "inactive-30";
}

function toSearchText(parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function buildSearchIndex(repositories, students) {
  const entries = [];

  repositories.forEach((repo) => {
    entries.push({
      type: "repository",
      label: repo.fullName,
      detail: `${repo.owner} | ${repo.primaryLanguage || "Unknown"} | ${repo.activityStatus}`,
      repoId: repo.id,
      searchText: toSearchText([
        repo.fullName,
        repo.owner,
        repo.organization,
        repo.section,
        repo.faculty,
        repo.primaryLanguage,
        repo.defaultBranch,
        repo.lastContributor,
        repo.lastCommitSha,
        ...repo.topics,
        ...(repo.contributors || []).flatMap((contributor) => [contributor.login, contributor.name]),
        ...(repo.branches || []).map((branch) => branch.name),
        ...(repo.workflowRuns || []).flatMap((run) => [run.name, run.branch, run.status, run.conclusion]),
        ...repo.commits.flatMap((commit) => [commit.shortSha, commit.message, commit.author, commit.authorLogin]),
        ...repo.openIssues.map((item) => item.title),
        ...repo.pullRequests.map((item) => item.title),
      ]),
    });
  });

  students.forEach((student) => {
    entries.push({
      type: "student",
      label: student.name,
      detail: `${student.repositoryCount} repos | ${student.commitCount} commits`,
      repoId: student.primaryRepoId,
      searchText: toSearchText([student.name, student.login, student.section, student.faculty, ...student.repositories]),
    });
  });

  return entries;
}

async function fetchAccessibleRepos(accessToken) {
  const repos = [];
  let page = 1;

  while (repos.length < MAX_REPOS) {
    const pageItems = await githubRest(
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      accessToken,
    );

    if (!pageItems.length) {
      break;
    }

    repos.push(...pageItems);
    page += 1;
  }

  return repos.slice(0, MAX_REPOS);
}

async function fetchOrganizations(accessToken) {
  const orgs = await githubRest("/user/orgs?per_page=100", accessToken).catch(() => []);
  return orgs.map((org) => ({
    id: org.id,
    login: org.login,
    avatarUrl: org.avatar_url,
    url: org.html_url,
  }));
}

async function fetchRepositoryBatch(repoNodes, accessToken) {
  const repositoryIds = repoNodes.map((repo) => repo.node_id);
  const query = `
    query RepositoryBatch($ids: [ID!]!, $sinceWeek: GitTimestamp!, $sinceMonth: GitTimestamp!) {
      nodes(ids: $ids) {
        ... on Repository {
          id
          name
          nameWithOwner
          isPrivate
          isArchived
          url
          description
          pushedAt
          updatedAt
          stargazerCount
          forkCount
          diskUsage
          repositoryTopics(first: 12) {
            nodes {
              topic {
                name
              }
            }
          }
          owner {
            login
          }
          primaryLanguage {
            name
            color
          }
          defaultBranchRef {
            name
            target {
              ... on Commit {
                history(first: 25, since: $sinceWeek) {
                  totalCount
                  nodes {
                    oid
                    committedDate
                    messageHeadline
                    additions
                    deletions
                    changedFilesIfAvailable
                    author {
                      name
                      user {
                        login
                      }
                    }
                    url
                  }
                }
                monthly: history(first: 100, since: $sinceMonth) {
                  totalCount
                }
              }
            }
          }
          openIssues: issues(states: OPEN) {
            totalCount
          }
          closedIssues: issues(states: CLOSED) {
            totalCount
          }
          openPullRequests: pullRequests(states: OPEN) {
            totalCount
          }
          mergedPullRequests: pullRequests(states: MERGED) {
            totalCount
          }
          closedPullRequests: pullRequests(states: CLOSED) {
            totalCount
          }
          latestIssues: issues(first: 8, orderBy: { field: UPDATED_AT, direction: DESC }, states: [OPEN, CLOSED]) {
            nodes {
              id
              number
              title
              state
              createdAt
              updatedAt
              author {
                login
              }
              url
            }
          }
          latestPullRequests: pullRequests(first: 8, orderBy: { field: UPDATED_AT, direction: DESC }, states: [OPEN, CLOSED, MERGED]) {
            nodes {
              id
              number
              title
              state
              createdAt
              updatedAt
              closedAt
              mergedAt
              reviewDecision
              mergeable
              isDraft
              author {
                login
              }
              reviewRequests(first: 6) {
                nodes {
                  requestedReviewer {
                    ... on User {
                      login
                    }
                  }
                }
              }
              url
            }
          }
          languages(first: 6, orderBy: { field: SIZE, direction: DESC }) {
            totalSize
            edges {
              size
              node {
                name
                color
              }
            }
          }
          collaborators: mentionableUsers(first: 12) {
            nodes {
              login
              name
              avatarUrl
            }
          }
        }
      }
    }
  `;

  const sinceWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sinceMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return githubGraphql(query, { ids: repositoryIds, sinceWeek, sinceMonth }, accessToken);
}

async function fetchRestRepoSupplements(repo, accessToken) {
  const [commits, pulls, workflows, branches] = await Promise.all([
    githubRest(`/repos/${repo.full_name}/commits?per_page=${MAX_ACTIVITY_ITEMS}`, accessToken).catch(() => []),
    githubRest(`/repos/${repo.full_name}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_ACTIVITY_ITEMS}`, accessToken).catch(() => []),
    githubRest(`/repos/${repo.full_name}/actions/runs?per_page=6`, accessToken).catch(() => ({ workflow_runs: [] })),
    githubRest(`/repos/${repo.full_name}/branches?per_page=8`, accessToken).catch(() => []),
  ]);

  return {
    commits: commits.map(normalizeCommit),
    pulls: pulls.map(normalizePull),
    workflowRuns: (workflows.workflow_runs || []).map(normalizeWorkflowSummary),
    branches: branches.map((branch) => ({
      name: branch.name,
      protected: Boolean(branch.protected),
    })),
  };
}

function mergeRepositoryData(restRepo, graphRepo, supplements, viewerLogin) {
  const topics = graphRepo.repositoryTopics.nodes.map((node) => node.topic.name);
  const metadata = extractMetadataFromTopics(topics);
  const graphCommits =
    graphRepo.defaultBranchRef?.target?.history?.nodes?.map((commit) =>
      normalizeCommit({
        oid: commit.oid,
        messageHeadline: commit.messageHeadline,
        committedDate: commit.committedDate,
        additions: commit.additions,
        deletions: commit.deletions,
        changedFiles: commit.changedFilesIfAvailable,
        author: {
          name: commit.author?.name,
          user: {
            login: commit.author?.user?.login,
          },
        },
        url: commit.url,
      }),
    ) || [];
  const commitIndex = new Map();

  [...supplements.commits, ...graphCommits].forEach((commit) => {
    if (commit?.sha && !commitIndex.has(commit.sha)) {
      commitIndex.set(commit.sha, commit);
    }
  });

  const commits = Array.from(commitIndex.values()).sort(
    (left, right) => new Date(right.committedAt).getTime() - new Date(left.committedAt).getTime(),
  );
  const lastCommit = commits[0] || null;
  const workflowRuns = supplements.workflowRuns;
  const latestWorkflow = workflowRuns[0] || null;
  const commitTodayCount = commits.filter((commit) => daysSince(commit.committedAt) === 0).length;
  const commitWeekCount = graphRepo.defaultBranchRef?.target?.history?.totalCount || commits.filter((commit) => daysSince(commit.committedAt) <= 7).length;
  const commitMonthCount = graphRepo.defaultBranchRef?.target?.monthly?.totalCount || commits.filter((commit) => daysSince(commit.committedAt) <= 30).length;
  const openPulls = supplements.pulls.filter((pr) => pr.state === "open");
  const pendingReviews = openPulls.filter((pr) => pr.reviewDecision === "REVIEW_REQUIRED").length;
  const mergeConflicts = openPulls.filter((pr) => pr.mergeable === "CONFLICTING").length;
  const tinyCommits = commits.filter((commit) => (commit.additions || 0) + (commit.deletions || 0) <= 4).length;

  return {
    id: Number(restRepo.id),
    nodeId: restRepo.node_id,
    name: restRepo.name,
    fullName: restRepo.full_name,
    owner: restRepo.owner?.login || graphRepo.owner.login,
    organization: restRepo.owner?.type === "Organization" ? restRepo.owner.login : "Personal",
    description: graphRepo.description || restRepo.description || "No description provided.",
    visibility: graphRepo.isPrivate ? "private" : "public",
    isArchived: graphRepo.isArchived,
    role: restRepo.owner?.login?.toLowerCase() === String(viewerLogin).toLowerCase() ? "owner" : "collaborator",
    topics,
    section: metadata.section,
    faculty: metadata.faculty,
    defaultBranch: graphRepo.defaultBranchRef?.name || restRepo.default_branch || "main",
    htmlUrl: graphRepo.url,
    updatedAt: graphRepo.updatedAt || restRepo.updated_at,
    pushedAt: graphRepo.pushedAt || restRepo.pushed_at,
    stars: graphRepo.stargazerCount || 0,
    forks: graphRepo.forkCount || 0,
    size: graphRepo.diskUsage || 0,
    primaryLanguage: graphRepo.primaryLanguage?.name || "Unknown",
    languageBreakdown: graphRepo.languages.edges.map((edge) => ({
      name: edge.node.name,
      color: edge.node.color,
      size: edge.size,
      percentage: graphRepo.languages.totalSize ? Math.round((edge.size / graphRepo.languages.totalSize) * 100) : 0,
    })),
    openIssueCount: graphRepo.openIssues.totalCount,
    closedIssueCount: graphRepo.closedIssues.totalCount,
    openPrCount: graphRepo.openPullRequests.totalCount,
    mergedPrCount: graphRepo.mergedPullRequests.totalCount,
    closedPrCount: graphRepo.closedPullRequests.totalCount,
    pendingReviews,
    mergeConflicts,
    commitTodayCount,
    commitWeekCount,
    commitMonthCount,
    tinyCommitCount: tinyCommits,
    lateCommitCount: commits.filter((commit) => {
      const date = new Date(commit.committedAt);
      const hour = date.getHours();
      return hour >= 22 || hour <= 4;
    }).length,
    lastCommitAt: lastCommit?.committedAt || graphRepo.pushedAt || restRepo.pushed_at,
    lastCommitSha: lastCommit?.shortSha || null,
    lastContributor: lastCommit?.author || "unknown",
    activityStatus: getActivityStatus(lastCommit?.committedAt || graphRepo.pushedAt || restRepo.pushed_at),
    workflowStatus: latestWorkflow?.conclusion || latestWorkflow?.status || "unknown",
    workflowRuns,
    branches: supplements.branches,
    issues: graphRepo.latestIssues.nodes.map(normalizeIssue),
    openIssues: graphRepo.latestIssues.nodes.filter((issue) => issue.state === "OPEN").map(normalizeIssue),
    pullRequests: supplements.pulls,
    commits,
    contributors: graphRepo.collaborators.nodes.map((contributor) => ({
      login: contributor.login,
      name: contributor.name || contributor.login,
      avatarUrl: contributor.avatarUrl,
    })),
  };
}

function buildStudentAnalytics(repositories) {
  const students = new Map();

  repositories.forEach((repo) => {
    repo.commits.forEach((commit) => {
      const key = (commit.authorLogin || commit.author || "unknown").toLowerCase();
      if (!students.has(key)) {
        students.set(key, {
          id: key,
          login: commit.authorLogin || null,
          name: commit.author,
          section: repo.section,
          faculty: repo.faculty,
          repositories: new Set(),
          repositoryCount: 0,
          commitCount: 0,
          commitTodayCount: 0,
          lastActivity: null,
          tinyCommitCount: 0,
          lateCommitCount: 0,
          primaryRepoId: repo.id,
        });
      }

      const student = students.get(key);
      student.repositories.add(repo.fullName);
      student.commitCount += 1;
      if (daysSince(commit.committedAt) === 0) {
        student.commitTodayCount += 1;
      }
      if (!student.lastActivity || new Date(commit.committedAt) > new Date(student.lastActivity)) {
        student.lastActivity = commit.committedAt;
        student.primaryRepoId = repo.id;
      }
      if ((commit.additions || 0) + (commit.deletions || 0) <= 4) {
        student.tinyCommitCount += 1;
      }
      const commitHour = new Date(commit.committedAt).getHours();
      if (commitHour >= 22 || commitHour <= 4) {
        student.lateCommitCount += 1;
      }
    });
  });

  return Array.from(students.values())
    .map((student) => ({
      ...student,
      repositories: Array.from(student.repositories),
      repositoryCount: student.repositories.size,
      inactivityDays: daysSince(student.lastActivity),
      attendanceScore: Math.max(0, 100 - Math.min(100, (daysSince(student.lastActivity) || 0) * 6)),
      performanceScore: Math.max(0, Math.min(100, student.commitCount * 4 - student.tinyCommitCount * 2)),
    }))
    .sort((left, right) => right.commitCount - left.commitCount || left.name.localeCompare(right.name));
}

function buildDashboardAnalytics(repositories, organizations, students) {
  const summary = {
    totalRepositories: repositories.length,
    activeToday: repositories.filter((repo) => repo.activityStatus === "active-today").length,
    inactive7Days: repositories.filter((repo) => ["inactive-7", "inactive-30"].includes(repo.activityStatus)).length,
    inactive30Days: repositories.filter((repo) => repo.activityStatus === "inactive-30").length,
    openPullRequests: repositories.reduce((sum, repo) => sum + repo.openPrCount, 0),
    openIssues: repositories.reduce((sum, repo) => sum + repo.openIssueCount, 0),
    draftPullRequests: repositories.reduce(
      (sum, repo) => sum + repo.pullRequests.filter((pr) => pr.isDraft).length,
      0,
    ),
    mergedPullRequests: repositories.reduce((sum, repo) => sum + repo.mergedPrCount, 0),
    commitsToday: repositories.reduce((sum, repo) => sum + repo.commitTodayCount, 0),
    commitsWeek: repositories.reduce((sum, repo) => sum + repo.commitWeekCount, 0),
    studentsActiveToday: students.filter((student) => student.commitTodayCount > 0).length,
    studentsInactive: students.filter((student) => (student.inactivityDays || 0) > 7).length,
    facultyMembers: new Set(repositories.map((repo) => repo.faculty).filter((value) => value !== "Unassigned")).size,
    organizationsConnected: organizations.length,
    pendingReviews: repositories.reduce((sum, repo) => sum + repo.pendingReviews, 0),
    failedWorkflows: repositories.filter((repo) => repo.workflowStatus === "failure").length,
    successfulWorkflows: repositories.filter((repo) => repo.workflowStatus === "success").length,
    repositoriesWithConflicts: repositories.filter((repo) => repo.mergeConflicts > 0).length,
  };

  const activityFeed = repositories
    .flatMap((repo) => [
      ...repo.commits.slice(0, 5).map((commit) => ({
        type: "Commit pushed",
        repoId: repo.id,
        repository: repo.fullName,
        actor: commit.author,
        title: commit.message,
        date: commit.committedAt,
        url: commit.htmlUrl,
      })),
      ...repo.pullRequests.slice(0, 3).map((pr) => ({
        type: pr.mergedAt ? "PR merged" : "PR updated",
        repoId: repo.id,
        repository: repo.fullName,
        actor: pr.author,
        title: pr.title,
        date: pr.updatedAt,
        url: pr.htmlUrl,
      })),
      ...repo.workflowRuns.slice(0, 2).map((run) => ({
        type: run.conclusion === "failure" ? "Workflow failed" : "Workflow updated",
        repoId: repo.id,
        repository: repo.fullName,
        actor: run.name,
        title: `${run.name} on ${run.branch}`,
        date: run.updatedAt,
        url: run.htmlUrl,
      })),
    ])
    .sort((left, right) => new Date(right.date) - new Date(left.date))
    .slice(0, 25);

  const orgRepoGroups = new Map();
  repositories.forEach((repo) => {
    const key = repo.organization || "Personal";
    if (!orgRepoGroups.has(key)) {
      orgRepoGroups.set(key, []);
    }
    orgRepoGroups.get(key).push(repo);
  });

  const organizationsSummary = Array.from(orgRepoGroups.entries())
    .map(([login, orgRepos]) => {
      const org = organizations.find((item) => item.login === login);
      return {
        id: org?.id || `scope-${login.toLowerCase()}`,
        login,
        avatarUrl: org?.avatarUrl || null,
        url: org?.url || "#",
        repositoryCount: orgRepos.length,
        studentCount: students.filter((student) => student.repositories.some((name) => name.startsWith(`${login}/`))).length,
        openIssues: orgRepos.reduce((sum, repo) => sum + repo.openIssueCount, 0),
        openPullRequests: orgRepos.reduce((sum, repo) => sum + repo.openPrCount, 0),
        failedWorkflows: orgRepos.filter((repo) => repo.workflowStatus === "failure").length,
      };
    })
    .sort((left, right) => right.repositoryCount - left.repositoryCount || left.login.localeCompare(right.login));

  return {
    summary,
    activityFeed,
    organizations: organizationsSummary,
  };
}

async function getAnalyticsPayload(accessToken, user) {
  const cacheKey = hashToken(accessToken);
  const cached = repoCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const [repos, organizations] = await Promise.all([
    fetchAccessibleRepos(accessToken),
    fetchOrganizations(accessToken),
  ]);

  const repositoryDetails = [];

  for (let index = 0; index < repos.length; index += GRAPHQL_BATCH_SIZE) {
    const chunk = repos.slice(index, index + GRAPHQL_BATCH_SIZE);
    const graphResult = await fetchRepositoryBatch(chunk, accessToken);

    const mergedChunk = await Promise.all(
      chunk.map(async (repo) => {
        const graphRepo = graphResult.nodes.find((node) => node?.nameWithOwner === repo.full_name);
        if (!graphRepo) {
          return null;
        }

        const supplements = await fetchRestRepoSupplements(repo, accessToken);
        return mergeRepositoryData(repo, graphRepo, supplements, user.login);
      }),
    );

    repositoryDetails.push(...mergedChunk.filter(Boolean));
  }

  const students = buildStudentAnalytics(repositoryDetails);
  const dashboard = buildDashboardAnalytics(repositoryDetails, organizations, students);
  const payload = {
    user,
    syncedAt: new Date().toISOString(),
    repositoryCount: repositoryDetails.length,
    repositories: repositoryDetails.sort((left, right) => new Date(right.lastCommitAt) - new Date(left.lastCommitAt)),
    students,
    organizations,
    dashboard,
    searchIndex: buildSearchIndex(repositoryDetails, students),
  };

  // TODO: Extend this payload with webhook-backed activity deltas so the client can
  // update counters in near real time without a full dashboard refresh.

  repoCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return payload;
}

function clearCachedPayload(accessToken) {
  if (!accessToken) {
    return;
  }
  repoCache.delete(hashToken(accessToken));
}

async function fetchRepositoryActivityPage(repoFullName, section, accessToken, page, perPage) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.min(ACTIVITY_PAGE_SIZE_LIMIT, Math.max(1, Number(perPage) || 20));

  if (section === "issues") {
    const items = await githubRest(`/repos/${repoFullName}/issues?state=all&per_page=${safePerPage}&page=${safePage}`, accessToken);
    return {
      section,
      page: safePage,
      perPage: safePerPage,
      items: items.filter((item) => !item.pull_request).map(normalizeIssue),
      hasMore: items.length === safePerPage,
    };
  }

  if (section === "pullRequests") {
    const items = await githubRest(`/repos/${repoFullName}/pulls?state=all&sort=updated&direction=desc&per_page=${safePerPage}&page=${safePage}`, accessToken);
    return {
      section,
      page: safePage,
      perPage: safePerPage,
      items: items.map(normalizePull),
      hasMore: items.length === safePerPage,
    };
  }

  if (section === "commits") {
    const items = await githubRest(`/repos/${repoFullName}/commits?per_page=${safePerPage}&page=${safePage}`, accessToken);
    return {
      section,
      page: safePage,
      perPage: safePerPage,
      items: items.map(normalizeCommit),
      hasMore: items.length === safePerPage,
    };
  }

  throw new Error("Unsupported activity section.");
}

app.get("/api/config", (_req, res) => {
  res.json({
    oauthReady: missingEnv.length === 0,
    missingEnv,
    scopes: ["repo", "read:org", "read:user", "workflow"],
  });
});

app.get("/api/auth/status", async (req, res) => {
  if (!req.session?.accessToken || !req.session?.user) {
    return res.json({
      authenticated: false,
      user: null,
      authError: req.session?.authError || null,
    });
  }

  if (isTokenExpired(req.session) && req.session.refreshToken) {
    await refreshGithubTokenIfNeeded(req);
  }

  return res.json({
    authenticated: true,
    user: req.session.user,
    authError: req.session.authError || null,
    expiresAt: req.session.tokenExpiresAt || null,
  });
});

app.get("/auth/github", (req, res) => {
  if (missingEnv.length) {
    return res.status(500).send(`GitHub OAuth is not configured. Missing: ${missingEnv.join(", ")}`);
  }

  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  req.session.authError = null;

  const redirectUri = process.env.GITHUB_REDIRECT_URI || `http://localhost:${PORT}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "repo read:org read:user workflow",
    state,
  });

  return res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get("/auth/github/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect("/?error=oauth_state_mismatch");
  }

  try {
    const tokenPayload = await exchangeGithubToken({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_REDIRECT_URI || `http://localhost:${PORT}/auth/github/callback`,
    });

    const user = await githubRest("/user", tokenPayload.access_token);

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) {
          reject(error);
          return;
        }

        req.session.accessToken = tokenPayload.access_token;
        req.session.refreshToken = tokenPayload.refresh_token || null;
        req.session.tokenExpiresAt = tokenPayload.expires_in ? Date.now() + tokenPayload.expires_in * 1000 : null;
        req.session.user = {
          login: user.login,
          name: user.name,
          avatarUrl: user.avatar_url,
          profileUrl: user.html_url,
        };
        req.session.authError = null;
        resolve();
      });
    });

    return res.redirect("/");
  } catch (error) {
    return res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/api/logout", (req, res) => {
  clearCachedPayload(req.session?.accessToken);
  req.session.destroy(() => {
    res.clearCookie("gitrac.sid");
    res.json({ ok: true });
  });
});

app.get("/api/sync", ensureAuthenticatedGithubSession, async (req, res) => {
  try {
    clearCachedPayload(req.session.accessToken);
    const payload = await getAnalyticsPayload(req.session.accessToken, req.session.user);
    return res.json(payload);
  } catch (error) {
    return res.status(error.status === 401 ? 401 : 500).json({
      message: error.message || "GitHub sync failed.",
      code: error.status === 401 ? "reauth_required" : "sync_failed",
    });
  }
});

app.get("/api/dashboard", ensureAuthenticatedGithubSession, async (req, res) => {
  try {
    const payload = await getAnalyticsPayload(req.session.accessToken, req.session.user);
    return res.json(payload);
  } catch (error) {
    return res.status(error.status === 401 ? 401 : 500).json({
      message: error.message || "Could not load the dashboard.",
      code: error.status === 401 ? "reauth_required" : "dashboard_failed",
    });
  }
});

// TODO: Add role-aware authorization middleware and faculty-section scoping once the
// application is backed by a persistent faculty/student assignment store.

app.get("/api/repository-activity", ensureAuthenticatedGithubSession, async (req, res) => {
  const { repoId, section, page, perPage } = req.query;

  if (!repoId || !section) {
    return res.status(400).json({ message: "repoId and section are required." });
  }

  try {
    const payload = await getAnalyticsPayload(req.session.accessToken, req.session.user);
    const repo = payload.repositories.find((item) => String(item.id) === String(repoId));

    if (!repo) {
      return res.status(404).json({ message: "Repository not found or not accessible." });
    }

    const activityPayload = await fetchRepositoryActivityPage(repo.fullName, section, req.session.accessToken, page, perPage);
    return res.json(activityPayload);
  } catch (error) {
    return res.status(error.status === 401 ? 401 : 500).json({
      message: error.message || "Could not load additional repository activity.",
    });
  }
});

app.use(express.static(path.join(__dirname)));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`giTrac running at http://localhost:${PORT}`);
  if (missingEnv.length) {
    console.log(`OAuth setup pending. Missing env: ${missingEnv.join(", ")}`);
  }
});
