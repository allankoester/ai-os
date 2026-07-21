# Steadymade AI OS — Operating Interface

Interactive web interface for the Steadymade AI OS agent system: agent map, knowledge
editor, workflows and command center. Reads the **real project files** and writes
Markdown edits **back to disk**.

## Start

```bash
node interface/server.mjs
# → http://localhost:4011
```

The server binds to `127.0.0.1` by default (local machine only).

No dependencies, no build step. Requires Node 22+.

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

# optional API auth token for mutating endpoints (POST/PUT/DELETE)
STEADYMADE_INTERFACE_TOKEN=

# fs backend root (absolute or path relative to apps/internal/steadymade-ai-os)
STEADYMADE_KNOWLEDGE_FS_ROOT=knowledge

# graph backend (prod VM)
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
GRAPH_DRIVE_ID=
GRAPH_KNOWLEDGE_ROOT=AI_OS/knowledge
```

### Dev mode (local machine)

Use filesystem backend and point to a OneDrive-synced local folder if desired:

```bash
STEADYMADE_RUNTIME=dev \
STEADYMADE_KNOWLEDGE_BACKEND=fs \
STEADYMADE_KNOWLEDGE_FS_ROOT="../../../_local/onedrive-company/AI_OS/knowledge" \
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
GRAPH_KNOWLEDGE_ROOT="AI_OS/knowledge" \
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
| Scheduler storage authority | SQLite canonical operational state (machine-local runtime root); JSON files are legacy compatibility inputs/exports only |
| Board storage authority | SQLite canonical operational state (local/private board domains) |
| Chat storage authority | `chat/history/*.jsonl` canonical transcripts + SQLite canonical session metadata/search index |
| Skill Hub | Live — search/filter over `skills/company` + `skills/personal`, activation via `.skill-profile` → `.claude/skills/` symlinks (API `/api/skills`) |
| Marketplace | Live — browses ComposioHQ/awesome-claude-skills, installs GitHub skills into `skills/personal/` (API `/api/marketplace`) |
| Plugins | Real for MCP/permissions — writes `.mcp.json` and `.claude/settings.local.json`; includes built-in `m365-readonly` (read-only delegated Graph) and `m365-write` (calendar-read + SharePoint write with confirm gate); external tools are config-only (API `/api/plugins`) |
| Profile editors | Real — Settings edits `knowledge/personal/user-profile.md`, `CLAUDE.local.md`, `CLAUDE.md` on disk |
| "Ask Nora / Mara / Atlas", "Run test task" | Prototype — copies a task brief to the clipboard; interactive chat execution pending |

## Guardrails

Guardrails are configured in two places:

1. **Global folder permissions** (`write`, `ask`, `read`, `deny`) — enforced by
   Settings → Guardrails, enforced by the interface file API, and materialized
   into `.claude/settings.local.json`.
2. **Agent-specific context access** — configured per specialist from Agent Map
   → agent drawer → Context Access. Stored in `interface/guardrails.json` as
   routing policy for which folders each specialist may use.

Agent-specific rules always inherit the global maximum. They cannot exceed
global permissions, and a globally denied folder stays denied for every agent.

Boundary note:

- There is no unified agent gateway in this app.
- Interface guardrail files and agent-specific entries are routing/policy metadata plus interface/API enforcement inputs.
- Invocation-time enforcement is runtime-specific (Claude runtime rules, interface file API checks, scheduler restrictions, MCP-local controls).

Use **Apply Secure Baseline** in Settings after onboarding a machine.

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

## Microsoft 365 MCP

- Built-in plugin id: `m365-readonly`
- Command path: `node mcp/m365/server.mjs` (repo-local, no `npx -y`)
- Auth intent: OAuth Authorization Code + PKCE (S256), work-account tenant only
- Tool scope: read-only profile/mail/tasks/OneDrive tools

- Built-in plugin id: `m365-write`
- Command path: `node mcp/m365-write/server.mjs`
- Tool scope: calendar reads + SharePoint read/write file tools
- Mutation guardrail: every write tool call requires explicit `confirm=true`

Setup guide: `docs/guide-m365-mcp-readonly-setup.md`
Setup guide (write server): `docs/guide-m365-mcp-write-setup.md`
