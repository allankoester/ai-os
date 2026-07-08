---
name: personal-onboarding
description: "Schneidet das Steadymade AI OS auf die einzelne Person zu — geführtes Interview zu Rolle, Aufgaben, Arbeitsweise und Kommunikation, schreibt daraus ein privates knowledge/personal/user-profile.md, erzeugt persönliche Custom Instructions in CLAUDE.local.md, gleicht das Skills-Profil in profiles/<user>.yml ab und bietet optional eine private Knowledge-Vault (user-gewählter lokaler Ordner, nie git, nie Shared Drive) an. Use whenever someone says '/personal-onboarding', 'personal onboarding', 'mein profil anlegen', 'workspace auf mich zuschneiden', 'persönliche instructions erstellen', 'set up my profile', 'private notizen ordner einrichten'. Betrifft nur die EINE Person — Firmenwissen gehört in /company-onboarding. Trigger proactively wenn kein user-profile.md existiert und jemand seine Rolle/Aufgaben vorstellt. Für schnelle Korrekturen user-profile.md oder CLAUDE.local.md direkt editieren."
---

# personal-onboarding — Das AI OS auf die Person zuschneiden

Dieser Skill erzeugt aus einem geführten Interview zwei Kategorien von
Ergebnissen, die **strikt getrennt** bleiben:

**A. Rollenbeschreibung & Settings — leben auf dem AI-OS-Hub** (dieses
Repo/dieser Workspace, git-verwaltet oder zumindest hub-lokal):

1. **`knowledge/personal/user-profile.md`** — das private Persona-Profil
   (Rolle, Aufgaben, Arbeitsweise, Kommunikation). Bleibt lokal im Hub, nie
   in git.
2. **`CLAUDE.local.md`** im Projekt-Root — die persönlichen Custom
   Instructions, die Claude Code zusätzlich zur geteilten CLAUDE.md lädt
   (gitignored). Kompakte Anweisungen, wie Danny mit *dieser* Person arbeitet.
3. **Abgleich von `profiles/<user>.yml`** — welche Agenten für diese Person
   core / optional / excluded sind (das ist geteilte Team-Konfiguration und
   geht durch Review).

**B. Persönliche Knowledge-Base — lebt in einem privaten, selbst gewählten
Ordner** (siehe Schritt 4b):

4. **`knowledge/personal/vault/`** (optional) — ein Symlink auf einen Ordner,
   den die Person selbst angibt, für eigene Notizen/Material über das
   Profil hinaus. Muss außerhalb von git und außerhalb des geteilten
   OneDrive-Company-Roots liegen — nie auf dem Shared Drive.

**Warum die Trennung wichtig ist:** Rolle/Settings (A) gehören zum Hub-Setup
und werden bei jeder Session gelesen. Die Knowledge-Base (B) ist Privatsache
der Person — der Skill erzwingt nicht, wo sie liegt, sondern lässt die Person
den Ort wählen, und verankert nur den Verweis (Symlink) im Hub.

**Abgrenzung zu `/company-onboarding`:** Jenes befüllt das *Unternehmens*-
Operating-Profile (gilt für alle). Hier geht es nur um die Person. Tauchen
Firmen-Fakten auf, notiere sie und verweise am Ende auf `/company-onboarding`
— trag sie nicht selbst ins Firmenwissen ein.

## Leitprinzipien

- **Privat bleibt privat.** `user-profile.md`, `CLAUDE.local.md` und ein
  eventuelles `knowledge/personal/vault/` sind gitignored und dürfen nie in
  Commits, Company-Knowledge oder Task Briefs an andere auftauchen
  (Stage-1-Trennungsregel, `knowledge/README.md`).
- **Hub vs. Vault nicht vermischen.** Rolle/Settings (A) bleiben im Hub —
  auch wenn die Person eine Vault einrichtet, wird `user-profile.md` nicht
  dorthin verschoben. Die Vault ist ausschließlich für zusätzliches privates
  Material, das über das Profil hinausgeht.
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
- Ist `knowledge/personal/vault` schon ein Symlink (`test -L knowledge/personal/vault`)?
  → Vault ist schon eingerichtet, Schritt 4b überspringen (außer die Person
  will den Zielordner ändern).

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
   hinweisen (`docs/runbook-team-operations.md`), nicht eigenmächtig mergen.

### Schritt 4b — Private Knowledge-Vault einrichten (optional)

Nur wenn `knowledge/personal/vault` laut Schritt 1 noch nicht existiert.
Frag aktiv, ob die Person das jetzt einrichten will — pflicht ist es nicht:

> „Willst du zusätzlich zum Profil einen eigenen Ordner für private Notizen/
> Material anbinden (`knowledge/personal/vault`)? Der bleibt komplett bei
> dir — nie in git, nie im geteilten OneDrive-Company-Ordner. Du kannst das
> jederzeit später per erneutem `/personal-onboarding` nachholen."

Bei „ja": per `AskUserQuestion` oder direkter Frage den **absoluten Pfad**
erfragen. Kandidaten, die der Person genannt werden können (keine Vorgabe,
nur Vorschläge):

- ein rein lokaler Ordner (z. B. `~/Documents/steadymade-private`),
- die eigene private OneDrive, falls unter `_local/onedrive-private`
  eingerichtet (`test -L _local/onedrive-private` prüfen — nur vorschlagen,
  wenn vorhanden; das ist die persönliche, nicht die geteilte
  Company-OneDrive).

**Validierung, bevor der Symlink angelegt wird** (beide müssen zutreffen,
sonst ablehnen und neu fragen):

```bash
# 1. Pfad darf nicht innerhalb dieses Repos liegen
case "$CHOSEN_PATH" in
  "$(pwd)"*) echo "REJECT: liegt im Repo — das wäre git-sichtbar" ;;
esac

# 2. Pfad darf nicht innerhalb des geteilten Company-OneDrive liegen
case "$CHOSEN_PATH" in
  "$(cd _local/onedrive-company 2>/dev/null && pwd)"*) echo "REJECT: liegt im geteilten OneDrive — nicht privat" ;;
esac
```

Existiert der gewählte Ordner noch nicht: mit Bestätigung anlegen
(`mkdir -p`). Danach den Symlink setzen:

```bash
ln -s "$CHOSEN_PATH" knowledge/personal/vault
```

`knowledge/personal/*` in `.gitignore` deckt den neuen Symlink automatisch ab
— keine weitere Gitignore-Änderung nötig. Bei „nein" oder „später": Schritt
überspringen, im Abschluss (Schritt 5) kurz erwähnen, dass es nachholbar ist.

### Schritt 5 — Abschluss

Fasse zusammen, was eingerichtet wurde und welche `TODO:`s offen sind —
inklusive Vault-Status (eingerichtet unter `<Pfad>` / bewusst übersprungen,
nachholbar). Weise darauf hin, dass die Person ihr Profil und
`CLAUDE.local.md` jederzeit selbst anpassen kann. Kamen Firmen-Fakten auf →
`/company-onboarding`.

## Referenzen

- `references/user-profile-template.md` — Profilvorlage + Leitfragen und
  CLAUDE.local.md-Blockvorlage. **Vor Schritt 2 lesen.**
- Verwandt: `/company-onboarding` (Firma statt Persona),
  `profiles/README.md` (Skills-Profil-Contract),
  `knowledge/README.md` (Hub- vs. Vault-Trennung im Detail).
