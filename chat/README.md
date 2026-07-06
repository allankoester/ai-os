# Steadymade AI OS — Danny Chat Frontend

Chat-Interface mit Streaming, in dem **Danny immer der Orchestrator** ist.
Jede Anfrage läuft durch den Agent-Workflow (CLAUDE.md + docs/agent-routing.md);
die Subagents (Nora, Clara, Rosa, Atlas, Kira …) werden über das Task-Tool geroutet.

Kein eigenständiges Frontend: Der Chat wird ausschließlich als iframe innerhalb
der `interface/`-Oberfläche (Agent Map, "Chat"-Nav-Item) genutzt, dort inklusive
Branding/Topbar. Der Server läuft auf einem eigenen Port, aber es gibt keine
direkte, eigenständige Nutzung mehr über `http://localhost:4012`.

## Start

```bash
node chat/server.mjs
# läuft auf http://localhost:4012 — wird via interface/ (Port 4011) eingebettet
```

Zero npm dependencies. Der Server spawnt den Claude-Code-CLI headless
(`--output-format stream-json`) mit cwd = Projektroot, dadurch werden
CLAUDE.md, `.claude/agents/`, Skills und Memory automatisch geladen.

## Wie es funktioniert

```
Browser ──POST /api/chat──▶ server.mjs ──spawn──▶ claude -p … (headless)
   ◀───────── SSE ────────────┘                     │
   init / delta / tool / result / gate / done ◀─────┘ (stream-json)
```

- **Danny-Modus:** via `--append-system-prompt` erzwungen (Routing obligatorisch,
  Writer→Rosa für externe Texte, Kie.ai-Workflow für Bilder, Approval-States).
- **Stil-Gate (deterministisch):** Der Server lintet jede finale Antwort auf
  Em-Dashes und „nicht/kein … sondern"-Konstruktionen und zeigt das Ergebnis im UI.
- **Subagent-Aktivität:** Task-/Tool-Aufrufe erscheinen als Chips über der Antwort
  (orange = Aktivität innerhalb eines Subagents).
- **Sessions:** Folge-Nachrichten laufen über `--resume <session_id>`
  (Session-ID liegt im localStorage; „Neu" startet frisch).
- **Modellwahl:** Standard (CLI-Default) / Sonnet / Haiku / Opus.

## Konfiguration (oben in `server.mjs`)

- `PERMISSION_MODE` — Default `acceptEdits`
- `ALLOWED_TOOLS` — Toolliste inkl. `Bash(python3:*)` für Kie.ai-Generierung
- `CLAUDE_BIN` (env) — überschreibt die automatische Binary-Suche
  (Default: neueste Version unter `~/Library/Application Support/Claude/claude-code/`)

## Abgrenzung

- `interface/` (Port 4011) = Lese-/Edit-UI für Agents & Knowledge-Dateien.
- `chat/` (Port 4012) = Agent-Runtime: echter Danny-Workflow mit Streaming.
- CLI-Arbeit direkt in Claude Code bleibt der „Werkstatt-Modus" ohne Frontend-Zwang.
