const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const app = express();
const PORT = Number(process.env.PORT || 4173);
const MAX_REPOS = Number(process.env.MAX_REPOS || 25);
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 15);
const MAX_ACTIVITY_PAGE_SIZE = 50;

const requiredEnv = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

app.use(express.json());
app.use(
  session({
    name: "gitrac.sid",
    secret: process.env.SESSION_SECRET || "development-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

function requireAuth(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ message: "You are not signed in with GitHub." });
  }
  return next();
}

function githubHeaders(accessToken) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "giTrac",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(pathname, accessToken, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      ...githubHeaders(accessToken),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `GitHub API request failed with ${response.status}`);
  }

  return response.json();
}

async function fetchAccessibleRepos(accessToken) {
  const repos = [];
  let page = 1;

  while (repos.length < MAX_REPOS) {
    const chunk = await githubFetch(
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      accessToken,
    );

    if (!chunk.length) {
      break;
    }

    repos.push(...chunk);
    page += 1;
  }

  return repos.slice(0, MAX_REPOS);
}

function normalizeIssue(item) {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    state: item.state,
    author: item.user?.login || "unknown",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    htmlUrl: item.html_url,
  };
}

function normalizePull(item) {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    state: item.state,
    author: item.user?.login || "unknown",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at,
    mergedAt: item.merged_at,
    htmlUrl: item.html_url,
  };
}

function normalizeCommit(item) {
  return {
    sha: item.sha,
    shortSha: item.sha.slice(0, 7),
    message: item.commit?.message?.split("\n")[0] || "No commit message",
    author: item.commit?.author?.name || item.author?.login || "unknown",
    committedAt: item.commit?.author?.date,
    htmlUrl: item.html_url,
  };
}

async function fetchRepoSnapshot(repo, username, accessToken) {
  const basePath = `/repos/${repo.full_name}`;
  const [issues, pulls, commits] = await Promise.all([
    githubFetch(`${basePath}/issues?state=all&per_page=${MAX_ITEMS}`, accessToken).catch(() => []),
    githubFetch(`${basePath}/pulls?state=all&per_page=${MAX_ITEMS}`, accessToken).catch(() => []),
    githubFetch(`${basePath}/commits?per_page=${MAX_ITEMS}`, accessToken).catch(() => []),
  ]);

  const normalizedIssues = issues.filter((item) => !item.pull_request).map(normalizeIssue);
  const normalizedPulls = pulls.map(normalizePull);
  const normalizedCommits = commits.map(normalizeCommit);

  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner?.login || "unknown",
    description: repo.description || "No description provided.",
    visibility: repo.private ? "private" : "public",
    role: repo.owner?.login?.toLowerCase() === String(username).toLowerCase() ? "owner" : "collaborator",
    topics: repo.topics || [],
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    issueCount: normalizedIssues.filter((item) => item.state === "open").length,
    openPrCount: normalizedPulls.filter((item) => item.state === "open").length,
    closedPrCount: normalizedPulls.filter((item) => item.state === "closed").length,
    issues: normalizedIssues,
    pullRequests: normalizedPulls,
    commits: normalizedCommits,
  };
}

async function fetchRepoActivityPage(repoFullName, section, accessToken, page, perPage) {
  const basePath = `/repos/${repoFullName}`;
  const safePage = Math.max(1, Number(page) || 1);
  const safePerPage = Math.min(MAX_ACTIVITY_PAGE_SIZE, Math.max(1, Number(perPage) || 20));

  if (section === "issues") {
    const items = await githubFetch(`${basePath}/issues?state=all&per_page=${safePerPage}&page=${safePage}`, accessToken);
    const filtered = items.filter((item) => !item.pull_request).map(normalizeIssue);
    return {
      section,
      page: safePage,
      perPage: safePerPage,
      items: filtered,
      hasMore: items.length === safePerPage,
    };
  }

  if (section === "pullRequests") {
    const items = await githubFetch(`${basePath}/pulls?state=all&per_page=${safePerPage}&page=${safePage}`, accessToken);
    return {
      section,
      page: safePage,
      perPage: safePerPage,
      items: items.map(normalizePull),
      hasMore: items.length === safePerPage,
    };
  }

  if (section === "commits") {
    const items = await githubFetch(`${basePath}/commits?per_page=${safePerPage}&page=${safePage}`, accessToken);
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
  });
});

app.get("/api/auth/status", async (req, res) => {
  if (!req.session.accessToken || !req.session.user) {
    return res.json({ authenticated: false, user: null });
  }

  return res.json({
    authenticated: true,
    user: req.session.user,
  });
});

app.get("/auth/github", (req, res) => {
  if (missingEnv.length) {
    return res.status(500).send(`GitHub OAuth is not configured. Missing: ${missingEnv.join(", ")}`);
  }

  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const redirectUri = process.env.GITHUB_REDIRECT_URI || `http://localhost:${PORT}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "repo read:org",
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
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI || `http://localhost:${PORT}/auth/github/callback`,
      }),
    });

    const tokenPayload = await tokenResponse.json();

    if (!tokenResponse.ok || tokenPayload.error || !tokenPayload.access_token) {
      throw new Error(tokenPayload.error_description || tokenPayload.error || "Could not complete GitHub OAuth.");
    }

    const user = await githubFetch("/user", tokenPayload.access_token);
    req.session.accessToken = tokenPayload.access_token;
    req.session.user = {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      profileUrl: user.html_url,
    };
    delete req.session.oauthState;

    return res.redirect("/");
  } catch (error) {
    return res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("gitrac.sid");
    res.json({ ok: true });
  });
});

app.get("/api/sync", requireAuth, async (req, res) => {
  try {
    const repos = await fetchAccessibleRepos(req.session.accessToken);
    const snapshots = [];

    for (const repo of repos) {
      const snapshot = await fetchRepoSnapshot(repo, req.session.user.login, req.session.accessToken);
      snapshots.push(snapshot);
    }

    return res.json({
      user: req.session.user,
      syncedAt: new Date().toISOString(),
      repositoryCount: snapshots.length,
      repositories: snapshots,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "GitHub sync failed." });
  }
});

app.get("/api/repository-activity", requireAuth, async (req, res) => {
  const { repoId, section, page, perPage } = req.query;

  if (!repoId || !section) {
    return res.status(400).json({ message: "repoId and section are required." });
  }

  try {
    const repos = await fetchAccessibleRepos(req.session.accessToken);
    const repo = repos.find((item) => String(item.id) === String(repoId));

    if (!repo) {
      return res.status(404).json({ message: "Repository not found or not accessible." });
    }

    const payload = await fetchRepoActivityPage(repo.full_name, section, req.session.accessToken, page, perPage);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Could not load additional repository activity." });
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
