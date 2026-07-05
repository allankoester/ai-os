# Vorlagen — user-profile.md und CLAUDE.local.md-Persona-Block

## Vorlage: knowledge/personal/user-profile.md

```markdown
# User Profile — <Name>

- **Rolle:** <eine Zeile>
- **Märkte:** <DACH / Australia / Both>
- **Sprache:** <de / en, wann welche>
- **Stand:** <YYYY-MM-DD>

## Verantwortung & Aufgaben

- <die 3–5 wichtigsten wiederkehrenden Aufgaben>
- <Kern-Deliverables>

## Arbeitsweise

- Entscheidungen: <wie die Person entscheidet, was sie vorbereitet haben will>
- Detailtiefe: <Executive-Kurzform vs. ausgearbeitete Analysen>
- Formate: <bevorzugte Output-Formate>

## Kommunikation

- Ton: <z.B. direkt, knapp, kritisch>
- Mit wem, wie: <interne/externe Kommunikationsmuster>

## Schmerzpunkte & Ziele

- Zeitfresser: <wo Zeit verloren geht — hier soll das AI OS zuerst helfen>
- Erfolgsmaß: <woran die Person Erfolg misst>

## Offene Punkte

- TODO: <bewusst offen gelassene Fragen>
```

Leitfragen pro Abschnitt: siehe die drei Interview-Blöcke in `SKILL.md`.
Konkretisierung erzwingen — „kommt drauf an" ist keine Antwort; um einen
Default bitten.

## Vorlage: CLAUDE.local.md-Persona-Block

Nur den Block zwischen den Markern pflegen; Rest der Datei (falls vorhanden)
unangetastet lassen.

```markdown
<!-- persona:start -->
# Persönliche Instructions — <Name>

- Ich bin <Rolle> (<Markt>). Vollständiges Profil: knowledge/personal/user-profile.md
- Antworte auf <Sprache>; Ton: <z.B. direkt, knapp, ohne Füllsätze>.
- Detailtiefe: <Default — z.B. erst Ergebnis in 3 Sätzen, Details auf Nachfrage>.
- Standard-Markt für Beispiele und Angebote: <DACH/Australia>.
- Proaktiv: <was Danny ungefragt tun soll, z.B. Strategy-Gate-Hinweise>.
- Nie: <persönliche No-Gos, z.B. Termine vorschlagen, Small Talk>.
<!-- persona:end -->
```
