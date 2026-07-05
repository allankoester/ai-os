# Steadymade AI OS — Claude Agent Setup

Dieses Paket ist für einen reinen Claude-/Claude-Code-Workflow gedacht: Danny ist der zentrale Orchestrator, alle anderen Rollen sind Subagents in `.claude/agents/`.

## Verwendung

1. ZIP entpacken.
2. Ordner als Claude-Code-Projekt öffnen.
3. Sicherstellen, dass `CLAUDE.md` im Projekt-Root liegt.
4. Subagents liegen unter `.claude/agents/`.
5. Danny als Hauptagent nutzen. Der User spricht nur mit Danny.

Claude/OpenCode compatibility details (Claude-first, no app-local `AGENTS.md`):

- `docs/claude-opencode-compatibility.md`

Cross-platform start/shutdown guide:

- `docs/how-to-start.md`
- `scripts/README.md`

## How to start

Open this folder as the project root:

```txt
apps/internal/steadymade-ai-os
```

The interface runs locally at:

```txt
http://localhost:4011
```

### macOS — double-click

Open `scripts/` in Finder and double-click:

```txt
start-mac.command
```

To stop the interface, double-click:

```txt
stop-mac.command
```

If macOS blocks execution, run this once from the repository root:

```bash
chmod +x apps/internal/steadymade-ai-os/scripts/start-mac.command
chmod +x apps/internal/steadymade-ai-os/scripts/stop-mac.command
```

### Windows — double-click

Open `scripts\` in File Explorer and double-click:

```txt
start-windows.cmd
```

To stop the interface, double-click:

```txt
stop-windows.cmd
```

### Terminal alternative

```bash
node scripts/start.mjs
```

```bash
node scripts/stop.mjs
```

To check the setup without starting the server:

```bash
node scripts/start.mjs --check-only
```

## Enthaltene Subagents

- `atlas-strategic-advisor.md` — Strategie und Positionierung
- `nora-knowledge-agent.md` — Wissenssuche und Kontextpakete
- `mara-setup-agent.md` — Setup, Profil, Wissensstruktur
- `ada-marketing-strategy.md` — Marketingstrategie und Kampagnenlogik
- `clara-writer.md` — Texte, LinkedIn, Website, Newsletter
- `rosa-review.md` — Review, Qualität, AI-Slop entfernen
- `otto-proposal-agent.md` — Angebote, Leistungsbausteine, Scopes
- `dora-document-agent.md` — Dokumente, Konzepte, PDF-/DOCX-ready Markdown
- `vera-visual-concept.md` — Bildideen und visuelle Konzepte
- `noah-image-prompt-router.md` — Image Prompts und Modellrouting
- `kira-image-generation-agent.md` — Kie.ai-ready Generation Packages
- `jonas-calendar-agent.md` — Planung und Redaktionskalender

## Struktur (Stage 1 + Stage 2)

Umsetzung von Stage 1 (persönliches lokales AI-OS) und Stage 2 (kleines Team) aus `docs/ai-os-comparison-and-staged-concept.md`:

- `knowledge/company/` — geteiltes Firmenwissen (in git)
- `knowledge/personal/` — privates Wissen (nie in git, siehe `.gitignore`)
- `knowledge/inbox/` — unsortierter Eingang, wird von Mara klassifiziert
- `templates/` — Task Brief, Approval-Checkliste, Qualitäts-Rubrik
- `runs/` — lokale Run-Logs (nicht in git)
- `profiles/` — Skills-Profile pro User (core / optional / excluded)
- `skills/` — Skill-Library (company geteilt, personal privat); Aktivierung über den Skill Hub im Interface
- `scheduler/` — Cron-Jobs für Agenten (Konfiguration über das Interface, Ausführung headless via `claude -p`)
- `scripts/` — `validate.mjs` (CI-Check), `backup.sh` (Backup/Restore)
- `docs/` — Onboarding, Sync-Policy, Runbook, Parity-Checkliste

Onboarding für neue Nutzer: `docs/stage1-onboarding.md`

## Prinzip

Danny ist der zentrale Gesprächspartner. Spezialagenten werden über klare Task Briefs beauftragt. Kein Subagent behauptet, externe Tools oder APIs auszuführen, solange diese nicht wirklich angebunden sind.
