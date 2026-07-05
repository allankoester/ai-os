# Steadymade AI OS — Operating Interface

Interactive web interface for the Steadymade AI OS agent system: agent map, knowledge
editor, workflows and command center. Reads the **real project files** and writes
Markdown edits **back to disk**.

## Start

```bash
node interface/server.mjs
# → http://localhost:4011
```

No dependencies, no build step. Requires Node 18+.

## Knowledge backends (dev vs prod)

The UI always works with virtual paths like `knowledge/<folder>/<file>.md`.
`server.mjs` maps those paths to a backend:

- `fs` backend (default): local filesystem root
- `graph` backend: OneDrive/SharePoint online via Microsoft Graph

### Environment variables

Copy `interface/.env.example` to your local env setup (do not commit secrets):

```bash
# optional runtime label for logs only
STEADYMADE_RUNTIME=dev

# fs | graph
STEADYMADE_KNOWLEDGE_BACKEND=fs

# fs backend root (absolute or path relative to apps/internal/steadymade-ai-os)
STEADYMADE_KNOWLEDGE_FS_ROOT=knowledge

# graph backend (prod VM)
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
GRAPH_DRIVE_ID=
GRAPH_KNOWLEDGE_ROOT=AI_OS_Knowledge
```

### Dev mode (local machine)

Use filesystem backend and point to a OneDrive-synced local folder if desired:

```bash
STEADYMADE_RUNTIME=dev \
STEADYMADE_KNOWLEDGE_BACKEND=fs \
STEADYMADE_KNOWLEDGE_FS_ROOT="/Users/allan/Applications/VS Code/steadymade-master/_local/onedrive-company/99_Resources/AI_OS_Knowledge" \
node interface/server.mjs
```

If `STEADYMADE_KNOWLEDGE_FS_ROOT` is not set, the server falls back to local
project storage at `apps/internal/steadymade-ai-os/knowledge`.

### Prod mode (VM)

Use Microsoft Graph backend to avoid local OneDrive sync dependency:

```bash
STEADYMADE_RUNTIME=prod \
STEADYMADE_KNOWLEDGE_BACKEND=graph \
MICROSOFT_TENANT_ID="..." \
MICROSOFT_CLIENT_ID="..." \
MICROSOFT_CLIENT_SECRET="..." \
GRAPH_DRIVE_ID="..." \
GRAPH_KNOWLEDGE_ROOT="99_Resources/AI_OS_Knowledge" \
node interface/server.mjs
```

Recommended auth model for VM:

- app registration in Microsoft Entra ID
- client credentials flow (app-only)
- drive/library scoped access where possible

Write conflicts in Graph backend are protected with ETag `If-Match`; if a file
changed remotely, writes return HTTP `409`.

## What is real vs. prototype

| Feature | State |
|---|---|
| Agent list | Live — parsed from `.claude/agents/*.md` frontmatter |
| Knowledge folders & docs | Live — from configured backend (`fs` root or Graph drive) |
| Markdown editing & saving | **Real persistence** — `PUT /api/file` writes to configured backend |
| Doc status / market scope | Sidecar file `interface/meta.json` (real docs stay untouched) |
| Access rules, workflows, departments | Static model in `public/data.js`, mirrors `CLAUDE.md` |
| Scheduler | **Real execution** — cron + one-time jobs (date/time picker) run `claude -p` headless, optional workflow/agent targeting (API `/api/scheduler`) |
| Skill Hub | Live — search/filter over `skills/company` + `skills/personal`, activation via `.skill-profile` → `.claude/skills/` symlinks (API `/api/skills`) |
| Marketplace | Live — browses ComposioHQ/awesome-claude-skills, installs GitHub skills into `skills/personal/` (API `/api/marketplace`) |
| Plugins | Real for MCP/permissions — writes `.mcp.json` and `.claude/settings.local.json`; external tools are config-only (API `/api/plugins`) |
| Profile editors | Real — Settings edits `knowledge/personal/user-profile.md`, `CLAUDE.local.md`, `CLAUDE.md` on disk |
| "Ask Nora / Mara / Atlas", "Run test task" | Prototype — copies a task brief to the clipboard; interactive chat execution pending |

## Files

```
interface/
├── server.mjs        Node server: static files + file API (path-guarded, .md only)
├── meta.json         created on first status change (sidecar metadata)
├── .env.example      backend/runtime configuration template
├── storage/
│   ├── config.mjs    env parsing and backend selection
│   ├── fs-storage.mjs    local filesystem knowledge adapter
│   └── graph-storage.mjs Microsoft Graph OneDrive/SharePoint adapter
└── public/
    ├── index.html    app shell (sidebar, topbar, drawer)
    ├── styles.css    Steadymade design tokens (no gradients, no shadows)
    ├── data.js       system model: agents, departments, access rules, workflows
    └── app.js        views, SVG agent map, markdown editor + renderer
```

## Where Claude integration would plug in later

- `app.js` → the `data-ask` and `test-task` handlers currently copy task briefs;
  replace with calls to a Claude runtime / Agent SDK.
- `server.mjs` → add a `/api/task` endpoint that forwards briefs to an agent runner.
