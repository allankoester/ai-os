# Steadymade AI OS Chat Runtime

Embedded chat runtime used by the interface Chat view.

- Server: `chat/server.mjs`
- UI: `chat/public/*`
- Default URL: `http://localhost:4012` (configurable via `CHAT_PORT`)

## Behavior

- Danny is always the entry point.
- Specialist selection in the UI is handled **via Danny routing instructions**.
- No direct specialist bypass mode.
- SSE events emitted to frontend: `init`, `delta`, `tool`, `result`, `gate`, `done`, `stderr`.
- Session resume is supported by passing `sessionId`.

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
