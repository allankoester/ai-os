# Claude/OpenCode Compatibility

This project is intentionally Claude-first.

- Canonical project instructions live in `CLAUDE.md`.
- Subagents live in `.claude/agents/`.
- Local guardrails live in `.claude/settings.local.json`.
- Local MCP setup lives in `.mcp.json`.

No `AGENTS.md` is created in this app on purpose.

## How instruction loading works

When you open `apps/internal/steadymade-ai-os`:

### In Claude Code

- Claude uses `CLAUDE.md` from the project root.
- Claude project subagents are read from `.claude/agents/`.
- Optional per-user instructions can be placed in `CLAUDE.local.md` (gitignored).

### In OpenCode

OpenCode evaluates local rule files with this order:

1. local `AGENTS.md`
2. local `CLAUDE.md`
3. global `~/.config/opencode/AGENTS.md`
4. global `~/.claude/CLAUDE.md` (if Claude compatibility is enabled)

Because this app intentionally has no local `AGENTS.md`, OpenCode falls back to
this app's local `CLAUDE.md` when opened from this folder.

Important:

- If a local `AGENTS.md` is added later, OpenCode will prefer that file over
  `CLAUDE.md`.
- If you open OpenCode from a parent folder, parent instructions can apply.
  Open the app root directly for app-local behavior.

## Provider and model behavior

### Claude Code

- Uses your Claude subscription/account and Claude runtime settings.
- Project behavior is guided by `CLAUDE.md`, `.claude/agents/`, and local
  Claude settings.

### OpenCode

- Uses providers/models configured in OpenCode config (`opencode.json` or
  global OpenCode config).
- Reading `CLAUDE.md` as instructions does not automatically copy Claude
  provider settings into OpenCode.

Practical implication: both tools can share instruction intent, but provider
selection and model routing remain tool-specific.

## Permissions and guardrails

There is **no unified agent gateway** shared by Claude Code and OpenCode in this repo.
Enforcement remains runtime-specific.

### Claude Code

- Runtime guardrails are materialized in `.claude/settings.local.json`.
- Folder-level guardrails configured in the interface are enforced by the local
  file API and then written to Claude local settings.

### OpenCode

- Permissions are controlled by OpenCode permission rules in OpenCode config.
- OpenCode does not automatically consume `.claude/settings.local.json` as its
  own permission policy.

Practical implication: instruction text can be shared, but permission enforcement
is independent per runtime.

Safe usage for governed actions:

- Use the runtime that enforces the required policy layer (Claude runtime + interface/scheduler constraints) for sensitive operations.
- Do not assume `.claude/settings.local.json` protections apply when running the same action in OpenCode.

## Agent/subagent instructions

- Claude subagents are defined in `.claude/agents/*.md` and used natively by
  Claude tooling.
- OpenCode has its own agent model and agent definitions when configured.
- This project remains Claude-first: no app-local OpenCode agent files are
  required for normal operation.

## Versioning boundary summary

- Git-versioned authority: `CLAUDE.md`, `.claude/agents/`, `skills/company/`, docs/code.
- Machine-local runtime state: `.skill-profile`, `.claude/skills/`, local plugin/guardrail state, generated local settings.

## Recommended operating mode for this app

1. Use Claude Code as the primary runtime.
2. Keep `CLAUDE.md` as single source of instruction truth for this app.
3. Keep OpenCode optional for compatible reading of `CLAUDE.md` fallback,
   without introducing app-local `AGENTS.md`.

## Local MCP integration note (Microsoft 365 read-only)

- Built-in plugin id: `m365-readonly`
- Materialized command: `node mcp/m365/server.mjs` (fixed local path)
- Scope: delegated Microsoft Graph read-only tools only (no mutation tools, no
  arbitrary Graph proxy)
- Auth design target: OAuth Authorization Code + PKCE (S256), work-account
  tenant only, no client secret for local public-client flow

Setup details: `docs/guide-m365-mcp-readonly-setup.md`
