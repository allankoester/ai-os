# Steadymade AI OS — Claude Agent Setup

Dieses Paket ist für einen reinen Claude-/Claude-Code-Workflow gedacht: Danny ist der zentrale Orchestrator, alle anderen Rollen sind Subagents in `.claude/agents/`.

## Verwendung

1. ZIP entpacken.
2. Ordner als Claude-Code-Projekt öffnen.
3. Sicherstellen, dass `CLAUDE.md` im Projekt-Root liegt.
4. Subagents liegen unter `.claude/agents/`.
5. Danny als Hauptagent nutzen. Der User spricht nur mit Danny.

## Steadymade OS Interface starten/stoppen

```bash
node apps/internal/steadymade-ai-os/interface/server.mjs
```

```bash
kill "$(lsof -ti tcp:4011)"
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

## Prinzip

Danny ist der zentrale Gesprächspartner. Spezialagenten werden über klare Task Briefs beauftragt. Kein Subagent behauptet, externe Tools oder APIs auszuführen, solange diese nicht wirklich angebunden sind.
