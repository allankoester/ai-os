---
name: personal-onboarding
description: "Schneidet das Steadymade AI OS auf die einzelne Person zu — geführtes Interview zu Rolle, Aufgaben, Arbeitsweise und Kommunikation, schreibt daraus ein privates knowledge/personal/user-profile.md, erzeugt persönliche Custom Instructions in CLAUDE.local.md und gleicht das Skills-Profil in profiles/<user>.yml ab. Use whenever someone says '/personal-onboarding', 'personal onboarding', 'mein profil anlegen', 'workspace auf mich zuschneiden', 'persönliche instructions erstellen', 'set up my profile'. Betrifft nur die EINE Person — Firmenwissen gehört in /company-onboarding. Trigger proactively wenn kein user-profile.md existiert und jemand seine Rolle/Aufgaben vorstellt. Für schnelle Korrekturen user-profile.md oder CLAUDE.local.md direkt editieren."
---

# personal-onboarding — Das AI OS auf die Person zuschneiden

Dieser Skill erzeugt aus einem geführten Interview drei Dinge:

1. **`knowledge/personal/user-profile.md`** — das private Persona-Profil
   (Rolle, Aufgaben, Arbeitsweise, Kommunikation). Bleibt lokal, nie in git.
2. **`CLAUDE.local.md`** im Projekt-Root — die persönlichen Custom
   Instructions, die Claude Code zusätzlich zur geteilten CLAUDE.md lädt
   (gitignored). Kompakte Anweisungen, wie Danny mit *dieser* Person arbeitet.
3. **Abgleich von `profiles/<user>.yml`** — welche Agenten für diese Person
   core / optional / excluded sind (das ist geteilte Team-Konfiguration und
   geht durch Review).

**Abgrenzung zu `/company-onboarding`:** Jenes befüllt das *Unternehmens*-
Operating-Profile (gilt für alle). Hier geht es nur um die Person. Tauchen
Firmen-Fakten auf, notiere sie und verweise am Ende auf `/company-onboarding`
— trag sie nicht selbst ins Firmenwissen ein.

## Leitprinzipien

- **Privat bleibt privat.** `user-profile.md` und `CLAUDE.local.md` sind
  gitignored und dürfen nie in Commits, Company-Knowledge oder Task Briefs
  an andere auftauchen (Stage-1-Trennungsregel, `knowledge/README.md`).
- **Nichts erfinden.** Nur eintragen, was die Person sagt. Offenes bleibt
  als `TODO:` stehen.
- **Kompakt statt vollständig.** Die Custom Instructions werden in jeder
  Session gelesen — lieber fünf präzise Zeilen als eine Seite Prosa.
- **Keine irrelevanten Privatdaten.** Nur erheben, was für die Arbeit
  relevant ist. Im Zweifel weglassen.
- **Idempotent.** Existieren Profil oder CLAUDE.local.md schon, behutsam
  aktualisieren — Lücken füllen, nichts klobbern, keine Duplikate.

## Ablauf

### Schritt 1 — Kontext lesen

Prüfe den Stand, bevor du fragst:

- Existiert `knowledge/personal/user-profile.md`? → Aktualisierungs-Modus.
- Existiert `CLAUDE.local.md`? → nur den Persona-Block pflegen.
- Gibt es `profiles/<user>.yml`? → Inhalte bestätigen lassen statt neu
  erfragen („In deinem Profil steht Rolle [X] — passt das noch?").

Sag der Person in einem Satz, was der Stand ist und was gleich passiert.

### Schritt 2 — Interview (drei Blöcke)

Leitfragen in `references/user-profile-template.md`. Regeln: **eine Frage pro
Nachricht**, immer mit Empfehlung, nach jeder Antwort kurz spiegeln, keine
vagen Antworten, konkrete Beispiele einfordern („Zeig mir eine typische
Aufgabe von letzter Woche"). Tiefe an die Rolle anpassen.

1. **Person & Rolle** — wer, welche Rolle, wofür verantwortlich, welche
   Märkte (DACH/Australien).
2. **Aufgaben** — was wiederholt sich täglich/wöchentlich, Kern-Deliverables,
   wofür soll das AI OS zuerst Zeit sparen.
3. **Arbeitsweise & Kommunikation** — Entscheidungsstil, Sprache (de/en),
   Tonalität, Detailtiefe, bevorzugte Formate, Schmerzpunkte, Ziele.

### Schritt 3 — Bestätigung

Spiel das Erfasste strukturiert zurück (Rolle / Aufgaben / Arbeitsweise /
Kommunikation / Schmerzpunkte / Ziele) und frag: „Was habe ich falsch
verstanden, was fehlt?" Erst nach Bestätigung schreibst du Dateien.

### Schritt 4 — Schreiben

1. `knowledge/personal/user-profile.md` nach
   `references/user-profile-template.md`.
2. `CLAUDE.local.md` — kompakter Persona-Block zwischen den Markern
   `<!-- persona:start -->` und `<!-- persona:end -->` (bei Updates nur
   diesen Block ersetzen). Inhalt: 5–10 Zeilen — wer die Person ist, wie
   Danny antworten soll (Sprache, Ton, Detailtiefe), Standard-Markt,
   was Danny proaktiv tun/lassen soll, Verweis auf das Profil.
3. `profiles/<user>.yml` — Vorschlag für core/optional/excluded auf Basis
   der Aufgaben; Änderung als Diff zeigen und auf den Review-Prozess
   hinweisen (`docs/team-operations-runbook.md`), nicht eigenmächtig mergen.

### Schritt 5 — Abschluss

Fasse zusammen, was eingerichtet wurde und welche `TODO:`s offen sind.
Weise darauf hin, dass die Person ihr Profil und `CLAUDE.local.md` jederzeit
selbst anpassen kann. Kamen Firmen-Fakten auf → `/company-onboarding`.

## Referenzen

- `references/user-profile-template.md` — Profilvorlage + Leitfragen und
  CLAUDE.local.md-Blockvorlage. **Vor Schritt 2 lesen.**
- Verwandt: `/company-onboarding` (Firma statt Persona),
  `profiles/README.md` (Skills-Profil-Contract).
