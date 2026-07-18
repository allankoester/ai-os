---
name: generation-package
version: 0.1.0
description: Bereitet Kie.ai-Generierungspakete vor und führt echte Generierungen aus — inkl. Submit/Poll-Disziplin, Status-Ehrlichkeit und Asset-Dokumentation. Aktivieren wenn ein Image Prompt Package generiert, ein Kie.ai-Job vorbereitet/verfolgt oder ein Asset dokumentiert werden soll — oder wenn /generation-package aufgerufen wird. Auch triggern bei "Bild generieren", "Kie.ai Job", "Generation Package".
---

# Generation Package

Kie.ai-Ausführungsdisziplin für Bildgenerierung. Wird von Vera (Creative Production) genutzt; ersetzt den früheren Kira-Agenten.

## API-Referenz (Pflichtlektüre vor jedem Paket)

`knowledge/company/marketing/creative/image-prompts/kie-ai-api-reference.md`

Dort stehen: Endpoint-URLs (`https://api.kie.ai/api/v1`), bestätigte Modellnamen (`nano-banana-pro`), Request-JSON-Struktur, Polling-Strategie, Aspect-Ratio-Mapping, Image-to-Image-Regeln, Fehlerbehandlung.

## Ausführungsregeln (Status-Ehrlichkeit)

- Nie annehmen, dass ein API-Key verfügbar ist. Nur wenn `KIE_AI_API_KEY` in einer freigegebenen Ausführungsumgebung gesetzt ist, echte Calls machen.
- Ohne Ausführungszugang: exaktes Generierungspaket vorbereiten und Status `Execution pending` setzen.
- Submit/Poll-Muster: Job einreichen, Task-ID festhalten, pollen bis Endstatus. Eine Generierung gilt erst als erledigt, wenn ein Ergebnis vorliegt; nie einen gestarteten Job als fertig melden.
- Generierte Bilder brauchen Review (Rosa) und User-Freigabe vor externer Nutzung.

## Pre-Execution Check

Das eingehende Image Prompt Package (aus dem `image-prompting`-Skill) muss enthalten: Library References, Adaptation Notes, Main Prompt, Negative Prompt, Aspect Ratio, Parameters. Fehlen Library References oder Adaptation Notes → Status `Missing library reference`, nicht ausführen.

## Output-Format

```markdown
### Kie.ai Generation Package

**Status:** Ready for execution / Missing inputs / Execution pending / Submitted (task-id) / Completed

**Intended Use:** Social / Website / Proposal / Document / Presentation / Other

**Generation Request:**
```json
{
  "provider": "kie.ai",
  "model": "nano-banana-pro",
  "prompt": "",
  "negative_prompt": "",
  "aspect_ratio": "",
  "output_count": 1,
  "quality": "",
  "metadata": {
    "project": "steadymade-ai-os",
    "department": "creative",
    "library_references": [],
    "requires_review": true
  }
}
```

**Missing Inputs:** [Liste oder "keine"]

**Asset Documentation:**
```json
{
  "asset_id": "",
  "title": "",
  "prompt": "",
  "model": "",
  "parameters": {},
  "library_references": [],
  "source_workflow": "",
  "status": "draft",
  "approved_for_use": false
}
```

**Next Step:** [was Danny oder der User als Nächstes tun soll]
```

## Regeln

- Prompt- und Parameter-Metadaten immer vollständig erhalten (Reproduzierbarkeit).
- Jedes generierte Asset bekommt eine Asset-Dokumentation; `approved_for_use` wird nur nach expliziter User-Freigabe true.
- Fehlerfälle (Timeout, Moderation, ungültige Parameter) dokumentieren statt stillschweigend neu versuchen.

## Changelog

- 0.1.0 (2026-07-18): Initiale Version — überführt aus dem aufgelösten Kira-Agenten (Phase 3 der Agent-Konsolidierung).
