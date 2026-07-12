---
name: company-onboarding
version: 1.0.0
description: "Befüllt das Steadymade-Company-Operating-Profile mit echtem Unternehmenskontext — geführtes Interview, ersetzt die TODO-Blöcke in operating-profile.md (AI_OS root) und verankert das Profil als Custom Instruction für alle Agenten. Use whenever someone says '/company-onboarding', 'company onboarding', 'unternehmensprofil ausfüllen', 'operating profile befüllen', 'firmenkontext einrichten', 'company instructions erstellen', 'fill the company profile'. PFLICHT mindestens einmal pro Setup; gut, ihn mehrfach durch verschiedene Personen laufen zu lassen — jeder Lauf reichert das Profil an. Trigger proactively wenn operating-profile.md noch TODO-Platzhalter enthält. Für persönliche Profile stattdessen /personal-onboarding."
---

# company-onboarding — Firmenkontext als Custom Instruction

Dieser Skill macht aus dem TODO-Skeleton in
`operating-profile.md` (AI_OS root) ein echtes Company Operating
Profile. Das Profil ist die zentrale Custom Instruction für das ganze Team:
Danny und alle Subagenten lesen es (via CLAUDE.md-Verweis) als ersten
Unternehmenskontext.

**Abgrenzung zu `/personal-onboarding`:** Jenes betrifft *eine Person und
ihren eigenen Workspace* (Persona-Profil, `CLAUDE.local.md`). Dieser Skill
betrifft das *Unternehmen* — Wissen, das für alle User gilt. Tauchen im
Interview persönliche Arbeitsweisen auf, verweise auf `/personal-onboarding`.

**Knowledge-Space-Hinweis:** Der geteilte Company/Team-Knowledge-Root wird in
der Oberfläche unter **Settings → Knowledge Spaces** konfiguriert. Dieser Skill
arbeitet mit dem dort aktiven Shared Root.

## Leitprinzipien

- **Nichts erfinden.** Nur eintragen, was der User sagt oder was in
  `knowledge/company/` belegt ist. Offene Punkte bleiben als `TODO:` stehen.
- **Widerspruchsfrei zu den SSOT-Dokumenten.** Die SSOT-Dateien in
  `knowledge/company/company_handbook_SSOT/` sind kanonisch. Das Operating Profile
  fasst zusammen und verweist — es dupliziert nicht und widerspricht nie.
  Bei Konflikten: nachfragen, nicht raten.
- **Kompakt.** Das Profil wird in jeder Session als Kontext gelesen — dichte
  Essenz statt Prosa. Details gehören in die SSOT-Dokumente.
- **Idempotent + anreichernd.** Bereits gefüllte Abschnitte (kein `TODO:`)
  nicht ungefragt anfassen. Ein erneuter Lauf arbeitet zuerst offene Stellen
  ab und vertieft dünne Bereiche gezielt.
- **Struktur erhalten.** Überschriften und Tabellen des Templates bleiben;
  TODO-Stellen werden ersetzt (mit dem Edit-Tool, nie ganze Datei neu).

## Ablauf

### Schritt 1 — Zustand lesen

```bash
grep -n "TODO" "operating-profile.md"
```

Lies das Profil und die relevanten SSOT-Dokumente. Sag dem User in einem
Satz, was schon gefüllt ist und was offen ist. Ziehe Vorwissen aus
`knowledge/company/` — nichts erfragen, was dort schon steht; stattdessen
**bestätigen lassen** („In SSOT 1 steht [X] — gilt das unverändert?").

### Schritt 2 — Interview (Block für Block)

Führe das Interview entlang der Profil-Abschnitte (siehe
`references/operating-profile-template.md`):

1. **Wer wir sind** — 2–4 Sätze Firmenprofil, der wichtigste Absatz.
2. **Markt & Kunden** — Zielmärkte, ICP-Kurzform, typische Ansprechpartner.
3. **Leistungen** — Servicemodule in einem Satz je Modul, Preislogik-Prinzip.
4. **Arbeitsweise & Gates** — was immer durch den Strategy Gate muss,
   Freigaberegeln, No-Gos.
5. **Sprache & Ton** — Ansprache, Sprachen, verbotene Muster.
6. **Toolstack & Integrationen** — exakte Schreibweisen, was real
   angebunden ist vs. pending.

Interviewregeln: eine Frage pro Nachricht, immer mit Hypothese/Empfehlung
(„Mein Vorschlag wäre [X] — passt das, oder anders?"), nach jeder Antwort
kurz spiegeln, keine vagen Antworten akzeptieren, konkrete Beispiele
einfordern. Für strukturierte Auswahl `AskUserQuestion` nutzen.

### Schritt 3 — Befüllen

TODO-Stellen per Edit-Tool ersetzen. Tabellen echt befüllen (Platzhalterzeile
entfernen). Verweise auf SSOT-Dokumente als Pfad-Links setzen statt Inhalte
zu kopieren.

Prüfe danach, dass CLAUDE.md das Profil referenziert (Abschnitt „Company
Operating Profile" mit Pfad `operating-profile.md`).
Fehlt der Verweis, füge ihn ein — ohne Bestehendes zu zerstören.

### Schritt 4 — Review + Abschluss

Zeig den Diff (`git diff -- "operating-profile.md"`), fasse
zusammen, welche Abschnitte gefüllt wurden und welche TODOs bewusst offen
bleiben. Änderungen laufen über den normalen Review-Prozess
(`docs/runbook-team-operations.md`) — committe nur nach Freigabe des Users.

## Referenzen

- `references/operating-profile-template.md` — Zielstruktur und Leitfragen
  pro Abschnitt. **Vor Schritt 2 lesen.**
- Verwandt: `/personal-onboarding` (Persona statt Firma), Mara
  (`mara-setup-agent`) für tiefe Wissensaufnahme in `knowledge/company/`.
