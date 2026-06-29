# giTrac

giTrac is a local dashboard for tracking GitHub repositories you own or collaborate on, using a safer backend OAuth flow instead of pasting a personal access token into the browser.

## What it does

- Signs in with GitHub using OAuth
- Keeps the GitHub access token on the local server session instead of browser storage
- Syncs repositories you can access, including owned and collaborator repositories
- Shows issues, pull requests, and recent commits per repository
- Stores the synced dashboard snapshot locally in browser `localStorage`
- Exports full dashboard data as `JSON`
- Exports repository summaries and per-repo commit history as `CSV`

## Why this setup is better for you

Your use case involves many student repositories, some owned by you and some shared with you as a collaborator. A backend OAuth flow is a better fit because:

- You do not need to manually create and paste a token every time
- The browser never directly stores the GitHub token
- The app can cleanly distinguish authenticated sessions from saved dashboard data
- It gives you a strong base for later upgrades like a database, scheduled sync, analytics, and multi-user access

## GitHub OAuth setup

You need to create a GitHub OAuth App once.

### 1. Create an OAuth App in GitHub

Go to GitHub:

`Settings -> Developer settings -> OAuth Apps -> New OAuth App`

Use values like:

- Application name: `giTrac Local`
- Homepage URL: `http://localhost:4173`
- Authorization callback URL: `http://localhost:4173/auth/github/callback`

After creating it, copy:

- `Client ID`
- `Client Secret`

### 2. Create your local env file

Copy `.env.example` to `.env` and fill in your values.

## Environment variables

```env
PORT=4173
SESSION_SECRET=replace-with-a-long-random-string
GITHUB_CLIENT_ID=your_github_oauth_app_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_app_client_secret
GITHUB_REDIRECT_URI=http://localhost:4173/auth/github/callback
MAX_REPOS=25
MAX_ITEMS=15
```

## Run locally

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Then open:

```text
http://localhost:4173
```

## Notes

- The backend uses an in-memory session, which is fine for local use
- If you restart the server, you may need to sign in again
- The current implementation fetches up to `25` repositories and up to `15` issues, PRs, and commits per repository
- The app can only access repositories your GitHub account is authorized to read
- For organization-owned repositories, your GitHub account and the OAuth authorization still need the proper access on GitHub itself

## Suggested next upgrades

- Add a database for permanent history snapshots
- Add scheduled background sync
- Add team-wise analytics and student progress comparisons
- Add pagination for deeper commit and issue history
