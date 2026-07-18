# Deaktivierte Agenten

Diese Agentendateien wurden im Zuge der Agent-Konsolidierung (2026-07-18,
siehe `knowledge/inbox/2026-07-13-agent-consolidation-migrationsplan.md`)
deaktiviert. Claude Code lädt nur `.claude/agents/`; Dateien hier sind
wirkungslos und dienen ausschließlich als Rollback-Reserve.

| Agent | Aufgelöst in |
|---|---|
| clara-writer | Ada + Skill `content-writing` (Phase 4) |
| jonas-calendar-agent | Ada + Skill `publication-calendar` (Phase 2) |
| dora-document-agent | Domänen-Agent + Skill `steadymade-docs` (Phase 2) |
| noah-image-prompt-router | Vera + Skill `image-prompting` (Phase 3) |
| kira-image-generation-agent | Vera + Skill `generation-package` (Phase 3) |

## Rollback

1. Datei zurück nach `.claude/agents/` verschieben.
2. Agent in allen `profiles/*.yml` wieder klassifizieren (validate.mjs erzwingt das).
3. Einträge wiederherstellen in: `chat/server.mjs` (`AGENT_FILE_ALIASES`, ggf.
   `CONTENT_AGENTS`), `interface/public/app.js` (`CHAT_AGENT_MAP`),
   `interface/public/data.js` (`AGENTS[]` und Workflow-Chains).
4. Zugehörige CLAUDE.md-Abschnitte (Departments, Workflows) zurückdrehen.

Löschung erst nach stabilem Betrieb der Nachfolgestruktur.
