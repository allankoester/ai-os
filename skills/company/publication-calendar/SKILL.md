---
name: publication-calendar
version: 0.1.0
description: Redaktions- und Publikationsplanung für Steadymade — Kadenz, Kalenderstruktur, Abhängigkeiten und Status-Disziplin. Aktivieren wenn ein Redaktionskalender, Publikationsplan, Kampagnenkalender oder eine Kadenz-Empfehlung gebraucht wird — oder wenn /publication-calendar aufgerufen wird. Auch triggern bei "Content planen", "Posting-Plan", "Redaktionsplan", "wann veröffentlichen".
---

# Publication Calendar

Planungslogik für Redaktions- und Publikationskalender. Wird von Ada (Marketing & Communications) genutzt; ersetzt den früheren Jonas-Agenten.

## Grundregeln

- Planen heißt nicht freigeben: „geplant" und „freigegeben" sind getrennte Zustände. Unfreigegebene Inhalte werden nie als „scheduled for publishing" markiert.
- Kadenz realistisch halten: Konsistenz schlägt Volumen.
- Wiederholung vermeiden: Themen und Formate über den Zeitraum verteilen, gleiche Angles nicht in aufeinanderfolgenden Slots.
- Jeder Slot kennt seine Abhängigkeiten (Review, Freigabe, Bild, Dokument).
- Ton- und Sprachregeln: `operating-profile.md` § Sprache & Ton.

## Kalenderformat

```markdown
### Redaktionsplan — [Zeitraum]

**Kadenz:** [empfohlene Frequenz je Kanal, mit Begründung]

| Datum | Kanal | Artefakt | Status | Abhängigkeiten | Notizen |
|---|---|---|---|---|---|

**Abhängigkeiten offen:**
- [Artefakt]: rosa-review ausstehend / Freigabe ausstehend / Bild fehlt

**Risiken:**
- [z. B. Themenwiederholung, fehlende Freigabe, unklare Priorität]

**Nächster Schritt:**
[konkrete Aktion]
```

Status-Werte folgen CLAUDE.md (idea / briefing / draft / review / strategy_check / approval_required / approved / final / archived).

## Kadenz-Heuristiken

- LinkedIn (Founder/Company): 1–3 Posts pro Woche tragfähig; lieber 1 konsistenter Slot als 3 wackelige.
- Newsletter: monatlich oder 14-tägig; nie ohne mindestens 2 vorproduzierte Ausgaben Puffer starten.
- Kampagnen: Ankerdatum rückwärts planen (Freigabe → Review → Draft → Briefing), Pufferzeit für rosa-review und User-Freigabe einrechnen.

## Changelog

- 0.1.0 (2026-07-18): Initiale Version — überführt aus dem aufgelösten Jonas-Agenten (Phase 2 der Agent-Konsolidierung).
