---
name: delivery-planning
version: 0.1.0
description: Formate und Regeln für Projektlieferung bei Steadymade — Meilensteinpläne, Risikoregister, Rollout-Phasen und Statusberichte. Aktivieren wenn ein Pilotplan, eine Implementierungs-Roadmap, ein Statusbericht, eine Übergabe-Checkliste oder ein Rollout-Readiness-Check gebraucht wird — oder wenn /delivery-planning aufgerufen wird. Auch triggern bei "Meilensteinplan", "Projektstatus", "Rollout planen", "Übergabe vorbereiten".
---

# Delivery Planning

Formate und Disziplin für Steadymade-Projektlieferung. Wird primär von Paula (Delivery-Agent) genutzt; Danny kann die Formate auch direkt anwenden.

## Grundregeln

- Jeder Plan hängt an einem unterschriebenen Angebot oder einer freigegebenen Spezifikation. Ohne diese Basis: Annahmen explizit markieren.
- Baseline vor Pilot: Messgrößen und Ausgangswerte werden definiert, bevor der Pilot startet. Ohne Baseline keine Wirkungsaussage.
- Status ist ehrlich: „geplant", „in Arbeit", „fertig", „vom Kunden abgenommen" sind vier verschiedene Zustände und werden nie vermischt.
- Kundengerichtete Delivery-Dokumente durchlaufen rosa-review und User-Freigabe vor Versand.
- Ton- und Sprachregeln: `operating-profile.md` § Sprache & Ton.

## Meilensteinplan

| Feld | Inhalt |
|---|---|
| Meilenstein | Kurzname |
| Ziel | Was danach wahr ist |
| Akzeptanzsignal | Woran Fertigstellung erkennbar ist (messbar oder beobachtbar) |
| Abhängigkeiten | Personen, Systeme, Daten, Freigaben |
| Zielfenster | Kalenderwoche oder Datum, als Ziel markiert, nicht als Zusage |

Regeln: maximal 5–7 Meilensteine pro Phase. Ein Meilenstein ohne Akzeptanzsignal ist keiner.

## Rollout-Phasen (Standard)

1. **Setup / Discovery** — Zugänge, Datenlage, Baseline-Messung, Kickoff.
2. **Pilot** — begrenzte Nutzergruppe oder begrenzter Prozess, Messung gegen Baseline, Human-in-Control-Checkpoints.
3. **Review / Measurement** — Pilotergebnisse gegen Baseline, Go/No-Go für Rollout, Anpassungsliste.
4. **Rollout** — schrittweise Ausweitung, Enablement, Betriebsübergabe.
5. **Handover / Operations** — Dokumentation, Verantwortliche, Monitoring, Supportweg.

Phasen anpassen, aber nie Review/Measurement überspringen.

## Risikoregister

| Risiko | Wahrscheinlichkeit (niedrig/mittel/hoch) | Auswirkung (niedrig/mittel/hoch) | Gegenmaßnahme | Owner |
|---|---|---|---|---|

Nur reale, projektspezifische Risiken. Generische Risiken („Scope Creep") nur mit konkretem Bezug.

## Statusbericht (Kompaktformat)

```markdown
### Status — [Projekt], [Datum]

**Gesamtstatus:** Grün / Gelb / Rot (mit einem Satz Begründung)

**Seit letztem Bericht:**
- erledigt: ...
- in Arbeit: ...

**Nächste Schritte:**
- ...

**Risiken / Blocker:**
- ...

**Entscheidungen offen:**
- Entscheidung, wer, bis wann
```

Gelb/Rot immer mit Ursache und Gegenmaßnahme, nie nur als Farbe.

## Übergabe-Checkliste (Rollout-Readiness)

- [ ] Pilotergebnisse dokumentiert und gegen Baseline ausgewertet
- [ ] Dokumentation vollständig (Setup, Betrieb, bekannte Grenzen)
- [ ] Verantwortliche auf Kundenseite benannt und eingewiesen
- [ ] Monitoring und Eskalationsweg definiert
- [ ] Offene Punkte mit Owner und Termin gelistet
- [ ] Kundenabnahme explizit dokumentiert

## Changelog

- 0.1.0 (2026-07-18): Initiale Version — Phase 1 der Agent-Konsolidierung (neuer Delivery-Agent Paula).
