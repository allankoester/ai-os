# Steadymade AI OS Chat Runtime

Embedded chat runtime used by the interface Chat view.

- Server: `chat/server.mjs`
- UI: `chat/public/*`
- Default embedded URL: `http://chat.localhost:4011` (single runtime listener from `interface/server.mjs`)
- Standalone compatibility still works via `node chat/server.mjs` (`CHAT_PORT` override)

## Behavior

- Agent modes:
  - `danny` (default): Danny orchestration prompt.
  - `direct_specialist`: selected specialist runs directly from
    `.claude/agents/*.md` prompt + shared safety addendum (approval logic,
    no false execution claims, memory/source-precedence reminders).
- `GET /api/agents` is the selector/source-of-truth endpoint (`id`, `name`,
  `function`, `mode`). UI labels use `Name — Function`.
- SSE events emitted to frontend: `conversation`, `init`, `delta`, `tool`,
  `result`, `gate`, `done`, `stderr`.
- Run lifecycle for non-incognito conversations is server-owned:
  - one active run per conversation (`POST /api/chat` returns `409` if active),
  - disconnect detaches subscriber only,
  - `GET /api/chat/attach?conversationId=&after=` replays buffered events and
    streams live updates,
  - `POST /api/chat/stop` explicitly terminates the run and persists partial
    assistant text when no final result exists.
- Incognito keeps connection-bound behavior (no persistence, no sessions,
  no history, no memory/run-log writes).

## Chat history (product-owned)

- `chat/history/<conversationId>.jsonl` — one append-only transcript per
  conversation (`user` / `tool` / `assistant` events).
- `chat/sessions.json` — conversation index (title, agent, timestamps, turns,
  `currentSessionId` for the resume chain, archived flag).
- Both are **gitignored, local per-user data** — same privacy class as
  `runs/` and `memory/` (may contain personal context; never committed,
  never shared).
- Endpoints: `GET /api/sessions` (`?all=1` includes archived; includes
  `running: true|false`),
  `GET /api/session?id=…` (transcript), `POST /api/session/rename`,
  `POST /api/session/archive`, `GET /api/sessions/search?q=…`.
- The UI shows a conversation sidebar: restore, resume, rename, archive,
  full-text search.
- The memory rules for this runtime live in the appended system prompt
  (`DANNY_PROMPT`): durable facts go to `memory/daily/` tagged `#durable`;
  direct edits to `memory/MEMORY.md` are blocked via `--disallowedTools`.
  **Warning:** setting `CHAT_DISALLOWED_TOOLS=''` disables the MEMORY.md
  write-block (memory-poisoning defense) — leave it at the default.
- Incognito turns: no history file, no index entry, no memory writes; the
  usage log keeps cost numbers only (no session id) and the Claude Code
  CLI's own transcript of the turn is deleted after the run as a best-effort
  cleanup (not an absolute guarantee).
- In unified mode, host routing is strict: only `chat.localhost:<port>` serves chat
  endpoints; unknown hosts are rejected by the interface runtime.

## Safety defaults

- Permission mode defaults to `default` (`CHAT_PERMISSION_MODE` to override).
- Tool allowlist is intentionally narrow by default (`Task,Read,Glob,Grep,Skill,WebFetch`).
- Broad write/edit/bash permissions are not granted silently.

## Interactive permissions

A `PreToolUse` hook (`chat/permission-hook.mjs`) gates every tool call so the
user stays in control of anything beyond safe reads:

- Safe, read-only tools (`CHAT_PERMISSION_SAFE_TOOLS`, defaults to the allowlist
  plus `WebSearch,TodoWrite,NotebookRead,BashOutput`) are auto-approved locally
  with no round trip.
- Anything else pauses the run and asks the user in the chat UI (**Allow once /
  Allow for this run / Deny**). The hook blocks on `POST /api/chat/permission-request`
  (localhost, per-run token) until the user decides via `POST /api/chat/permission-decision`;
  the tool card shows an `awaiting_permission` state meanwhile.
- Writes to `memory/MEMORY.md` are always denied, even with approval
  (memory-poisoning defense), independent of `--disallowedTools`.
- On timeout (`CHAT_PERMISSION_TIMEOUT_MS`, default 5 min), run stop, or run end,
  pending requests are auto-denied — a headless run never silently performs a
  gated action.
- The hook is injected via `--settings` (merged with the project's settings, so
  `SessionStart` etc. still run) and is enabled by default; set
  `CHAT_INTERACTIVE_PERMISSIONS=0` to fall back to the previous behavior
  (non-allowlisted tools simply fail).

Because this widens what the runtime can do (with per-action user approval), it
is a security-relevant surface — have Simon review permission/hook changes
before committing (see the root `CLAUDE.md`).

## Activity trace (UI)

The chat renders each turn's tool calls as one collapsible **trace**: the head
always shows the current step (refreshing as work proceeds) or a summary when
done; expanding reveals the full step timeline with per-step input/result,
sub-agent tool calls nested under their `Task`, live status (running / done /
error / awaiting permission), and inline permission prompts. Server tool events
carry `detail` (short label), `input`/`result` previews, `status`, `parent_id`
(sub-agent nesting) and `permission_id`.

## Usage logging

Each turn appends JSONL usage metadata to:

`runs/chat-usage.jsonl`

Fields include timestamp, session_id, selected agent/mode, model, duration, cost, turns, and error flag.

## Run manually

```bash
node chat/server.mjs
```

Normal startup launches `interface/server.mjs` only; chat is composed into that
single listener through host routing.
