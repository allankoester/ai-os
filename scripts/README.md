# Start and Stop Scripts

Use these scripts to run the Steadymade AI OS interface locally.

The interface starts at:

```txt
http://localhost:4011
```

## macOS — double-click

Open this folder in Finder:

```txt
apps/internal/steadymade-ai-os/scripts/
```

Double-click:

```txt
start-mac.command
```

To stop it, double-click:

```txt
stop-mac.command
```

If macOS blocks the files, run this once from the repository root:

```bash
chmod +x apps/internal/steadymade-ai-os/scripts/start-mac.command
chmod +x apps/internal/steadymade-ai-os/scripts/stop-mac.command
```

If Gatekeeper still warns, right-click the file, choose **Open**, then confirm.

## Windows — double-click

Open this folder in File Explorer:

```txt
apps\internal\steadymade-ai-os\scripts\
```

Double-click:

```txt
start-windows.cmd
```

To stop it, double-click:

```txt
stop-windows.cmd
```

The `.cmd` files call the PowerShell scripts with a local bypass policy so the
user does not need to change the global PowerShell execution policy.

## Terminal commands

Start:

```bash
node scripts/start.mjs
```

Stop:

```bash
node scripts/stop.mjs
```

Check setup without starting:

```bash
node scripts/start.mjs --check-only
```

## What the start script checks

- `CLAUDE.md` exists
- `.claude/agents/` exists
- `interface/server.mjs` exists
- `knowledge/` exists
- `scripts/validate.mjs` exists and passes
- port `4011` is free before starting

If port `4011` is already in use, stop the running instance first.
