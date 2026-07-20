# Agent Versioning and Permission Boundaries

Status: normative reference (current runtime)
Date: 2026-07-20
Scope: `interface/`, `chat/`, `scheduler/`, skills/agents configuration boundaries

## 1) Runtime authority statement

- There is **no unified agent gateway** in this repository today.
- Authorization and tool/file controls are enforced by runtime-specific layers, not by a single cross-runtime policy engine.
- Agent declarations, skill metadata, and plugin dependency declarations are routing/dependency metadata unless a specific runtime layer enforces them.

## 2) Authoritative data matrix

This matrix is the canonical mapping for current storage authority.

| Domain | Canonical store format | Physical location class | Derived compatibility exports | Migration/authority marker notes |
|---|---|---|---|---|
| Knowledge markdown | Markdown (`knowledge/**/*.md`) | Workspace | Optional index/search caches | Authority remains file-based (OneDrive/Graph or FS adapter by backend) |
| Memory markdown | Markdown (`memory/MEMORY.md`, `memory/daily/*.md`) | Workspace (gitignored) | Optional summaries/proposals in `runs/` | No DB authority marker; file contract remains canonical |
| Run logs markdown | Markdown (`runs/*.md`) | Workspace (gitignored except README/templates) | Optional dashboard projections | No DB authority marker; run logs remain canonical narrative artifacts |
| App/provider/plugin/guardrail settings JSON | JSON (`interface/*.json`, `.mcp.json`) | Workspace (mostly gitignored runtime state) | Generated projections (for example `.claude/settings.local.json`) | JSON files remain canonical for these settings domains |
| Private board operational state | SQLite | Machine-local runtime root | Optional read-only JSON/Markdown projections | Domain authority marker set to `sqlite`; JSON entities are legacy-only compatibility |
| Team board state (deferred) | Deferred central team service (not local authority) | N/A for canonical in current runtime | Optional read-only projections only | Team authority intentionally unresolved locally; no fallback local canonical writes |
| Scheduler operational state | SQLite | Machine-local runtime root | Optional JSON snapshots for compatibility/debug | Domain authority marker set to `sqlite`; `scheduler/jobs.json` and `scheduler/runs.json` are legacy inputs only |
| Board/scheduler lifecycle events | SQLite event tables | Machine-local runtime root | Optional JSONL/Markdown exports | Transactional with lifecycle state; export failures do not change canonical authority |
| Chat session metadata/search index | SQLite | Machine-local runtime root | Optional `chat/sessions.json` transition export | Domain authority marker set to `sqlite`; JSON session index is non-canonical compatibility only |
| Chat transcripts | JSONL (`chat/history/*.jsonl`) | Machine-local runtime root (`chat/`, gitignored) | SQLite metadata/index projections | JSONL transcripts stay canonical; SQLite search/index remains derived |
| Usage telemetry canonical stream + usage projections | Canonical JSONL stream (`runs/usage.jsonl`) + derived SQLite projections | Workspace canonical stream + machine-local projection DB | Legacy `runs/chat-usage.jsonl` compatibility read path | Usage stream remains canonical append log; SQLite aggregates are rebuildable derived state |
| Artifact binaries + artifact metadata catalog | Binary files in approved artifact roots + SQLite metadata catalog | Binaries: workspace approved roots; metadata: machine-local runtime root | Optional previews/thumbnails/manifests | Metadata authority marker set to `sqlite`; binaries remain file-authoritative by root policy |
| CRM caches/reference projections | SQLite/JSON cache (non-authoritative) | Machine-local runtime root | UI joins/projections | External authority remains Twenty CRM when enabled; local cache rows must be marked derived |

## 3) Versioning boundaries

### 3.1 Git-versioned authority

The following are canonical in Git:

- Agent definitions under `.claude/agents/`
- Company skills under `skills/company/`
- Skill/agent registry metadata committed in repository docs/code
- `opencode.jsonc` (when present in repo)
- Repository docs and source code

### 3.2 Machine-local, gitignored runtime state

The following are local runtime state and are not canonical in Git history:

- Active skill profile (`.skill-profile`)
- Materialized skills (`.claude/skills/` symlinks)
- Plugin runtime state (`interface/plugins.json`) where locally managed
- Generated MCP/runtime config (`.mcp.json` when locally generated)
- Guardrails local policy data (`interface/guardrails.json` runtime output + `.claude/settings.local.json`)
- Generated Claude local settings and runtime projections

### 3.3 Validator enforcement boundary (`scripts/validate.mjs`)

Validator enforces selected repository contracts (examples: folder contracts, skill metadata rules for company skills, profile/schema consistency).

Validator does **not** enforce runtime invocation-time authorization decisions across all tools/runtimes. It also does not convert routing metadata into hard authorization.

## 4) Permission and enforcement boundaries

### 4.1 Runtime-specific enforcement layers (actual)

1. **Claude Code runtime rules**
   - Tool allow/disallow sets and local settings are enforced by Claude runtime for that execution lane.
2. **Interface file API checks** (`interface/server.mjs` and related modules)
   - Path validation, guarded write surfaces, and local policy checks are enforced at API invocation time.
3. **Scheduler tool restrictions** (`interface/scheduler.mjs`)
   - Scheduler enforces restricted tool sets and additional hard limits for headless jobs.
4. **MCP-local controls**
   - MCP server/tool exposure is bounded by local MCP config and each MCP server's own scope.

### 4.2 Policy/config metadata (not independent auth)

- Agent-specific guardrail entries are routing policy metadata and constraint inputs.
- Agent/skill plugin declarations and dependency tags are dependency/routing metadata.
- These metadata layers are not standalone, runtime-agnostic authorization engines.

### 4.3 OpenCode compatibility safety statement

- OpenCode does **not** consume `.claude/settings.local.json` as its permission authority.
- Governed actions must be run in the runtime that enforces the expected policy layer (for example Claude runtime + interface enforcement), or equivalent OpenCode-native permission policy must be explicitly configured.
