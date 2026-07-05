# How To Start (Mac + Windows)

Use the scripts in `scripts/` to validate setup and run the interface in a
known initial local state.

Initial state defaults:

- `STEADYMADE_RUNTIME=dev`
- `STEADYMADE_KNOWLEDGE_BACKEND=fs`
- `STEADYMADE_KNOWLEDGE_FS_ROOT=knowledge`

These defaults are applied only when env vars are not already set.

## Start

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

## What is validated before start

- required files and folders exist (`CLAUDE.md`, `.claude/agents/`,
  `interface/server.mjs`, `knowledge/`, `scripts/validate.mjs`)
- optional local files are reported (`.claude/settings.local.json`, `.mcp.json`)
- `node scripts/validate.mjs` runs successfully
- port `4011` is free before startup

If port `4011` is in use, run `node scripts/stop.mjs` and start again.
