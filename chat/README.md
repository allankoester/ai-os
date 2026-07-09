# Steadymade AI OS Chat Runtime

Embedded chat runtime used by the interface Chat view.

- Server: `chat/server.mjs`
- UI: `chat/public/*`
- Default URL: `http://localhost:4012` (configurable via `CHAT_PORT`)

## Behavior

- Danny is always the entry point.
- Specialist selection in the UI is handled **via Danny routing instructions**.
- No direct specialist bypass mode.
- SSE events emitted to frontend: `conversation`, `init`, `delta`, `tool`, `result`, `gate`, `done`, `stderr`.
- Conversations are resumed by passing `conversationId`; the server resolves
  the Claude session chain internally (legacy `sessionId` still accepted).

## Chat history (product-owned)

- `chat/history/<conversationId>.jsonl` — one append-only transcript per
  conversation (`user` / `tool` / `assistant` events).
- `chat/sessions.json` — conversation index (title, agent, timestamps, turns,
  `currentSessionId` for the resume chain, archived flag).
- Both are **gitignored, local per-user data** — same privacy class as
  `runs/` and `memory/` (may contain personal context; never committed,
  never shared).
- Endpoints: `GET /api/sessions` (`?all=1` includes archived),
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
  CLI's own transcript of the turn is deleted after the run.
- The server binds `127.0.0.1` only — it must never be exposed to the LAN
  (it drives Claude with project permissions and has no auth).

## Safety defaults

- Permission mode defaults to `default` (`CHAT_PERMISSION_MODE` to override).
- Tool allowlist is intentionally narrow by default (`Task,Read,Glob,Grep,Skill,WebFetch`).
- Broad write/edit/bash permissions are not granted silently.

## Usage logging

Each turn appends JSONL usage metadata to:

`runs/chat-usage.jsonl`

Fields include timestamp, session_id, selected agent/mode, model, duration, cost, turns, and error flag.

## Run manually

```bash
node chat/server.mjs
```

`scripts/start.mjs` will also start this runtime automatically when present and when the chat port is free.
