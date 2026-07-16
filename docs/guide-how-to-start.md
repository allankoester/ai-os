# Start and Stop Guide

Use the scripts in `scripts/` to validate setup and run the interface in a
known initial local state.

## Prerequisites by user type

| Requirement | single-user | team-user | collaborator |
|---|---:|---:|---:|
| Node.js >= 18 | required | required | required |
| `npm ci` | required | required | required |
| git | optional | optional | required |

Initial state defaults:

- `STEADYMADE_RUNTIME=dev`
- `STEADYMADE_KNOWLEDGE_BACKEND=fs`
- `STEADYMADE_KNOWLEDGE_FS_ROOT=knowledge`

These defaults are applied only when env vars are not already set.

## Start

Before first start:

```bash
npm ci
```

### macOS

```bash
node scripts/start.mjs
```

or

```bash
./scripts/start-mac.command
```

### Windows (PowerShell)

Double-click in File Explorer:

```txt
scripts\start-windows.cmd
```

or run manually:

```powershell
node scripts/start.mjs
```

or

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

## Shutdown

### macOS

```bash
node scripts/stop.mjs
```

or

```bash
./scripts/stop-mac.command
```

### Windows (PowerShell)

Double-click in File Explorer:

```txt
scripts\stop-windows.cmd
```

or run manually:

```powershell
node scripts/stop.mjs
```

or

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-windows.ps1
```

## Check-only mode

Validate paths and configuration without starting the server:

```bash
node scripts/start.mjs --check-only
```

`--check-only` prints PASS/WARN/FAIL entries and exits with:

- `0` when no blocking failures are found
- `1` when blocking failures are found

## What is validated before start

- required files and folders exist (`CLAUDE.md`, `.claude/agents/`,
  `interface/server.mjs`, `knowledge/`, `scripts/validate.mjs`)
- `node scripts/validate.mjs` runs successfully
- runtime dependencies used by chat runtime are installed (`node_modules`)
- ports `4011` (interface) and `4012` (chat)
- machine-local onboarding user type is set
- git is required only for `collaborator`
- selected provider local readiness (binary/config only)

If port `4011` is in use, run `node scripts/stop.mjs` and start again.

Deep provider tests are separate from startup preflight and run on demand in
the interface (**Settings -> AI Provider -> Run deep provider test**).
