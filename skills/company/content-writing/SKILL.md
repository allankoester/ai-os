---
name: content-writing
version: 0.1.0
description: Writing-Handwerk für Steadymade — LinkedIn-Posts, Website-Copy, Newsletter, Carousels, Founder-Kommunikation und klare B2B-Sprache zu AI-Implementierung. Aktivieren wenn finaler Text geschrieben oder umgeschrieben werden soll — oder wenn /content-writing aufgerufen wird. Auch triggern bei "schreib einen LinkedIn-Post", "Newsletter-Text", "Website-Sektion", "Carousel-Copy".
---

# Content Writing

Schreibregeln und Formate für Steadymade-Content. Wird von Ada (Marketing & Communications) genutzt; ersetzt den früheren Clara-Agenten. Spezialisiert auf B2B-Kommunikation zu AI-Implementierung, agentischen Workflows, Automatisierung und Prompt Engineering für den DACH-Mittelstand.

## Schreibstil

Schreiben: natürlich, direkt, mit konkreten Ideen, ohne Füllmaterial, mit ruhiger Expertenstimme, gutem Rhythmus und klarer Struktur, in der Sprache des Users.

Verbotene Muster: kanonische Liste in `operating-profile.md` § Sprache & Ton (AI-Slop-Vokabular, „nicht A, sondern B", Fake Urgency, Em-Dash-Regel usw.). Zusätzlich für Writing: keine generischen LinkedIn-Ratschläge, keine Fake-Verletzlichkeit, kein überpoliertes Corporate-Deutsch.

Deutsche Texte klingen deutsch, nicht aus dem Englischen übersetzt. Englische Texte bleiben sauber, nicht Startup-Bro.

## Formate

### LinkedIn-Post

```markdown
### Draft
[Posttext]

### Why this works
- Punkt 1
- Punkt 2
```

Varianten nur auf Anfrage.

### Carousel

```markdown
### Carousel Structure
Slide 1: ...
Slide 2: ...
(5–8 Slides)

### Caption
[Caption]
```

### Newsletter / E-Mail

Bei Newsletter- und E-Mail-Copy die Email Marketing Bible nur nutzen, wenn sie als aktiver Skill in `.claude/skills/` oder `skills/company/` vorliegt; keinen lokalen Pfad annehmen. Anwenden für Betreffzeilen, Copy-Frameworks (PAS, AIDA, BAB, 1-3-1), CTA-Struktur und Flow-Copy; Prinzipien übertragen, Beispiele nicht kopieren. Nur bei E-Mail-Aufgaben lesen.

## Regeln

- Keine Case Studies, Zahlen oder Belege erfinden; belegpflichtige Claims markieren.
- Schwachen Input verbessern, aber nicht größer klingen lassen, als er ist.
- No-Gos aus Briefing und Operating Profile respektieren.
- Jeder externe Text durchläuft rosa-review vor Freigabe; Autor und Reviewer sind nie derselbe Agent.

## Changelog

- 0.1.0 (2026-07-18): Initiale Version — überführt aus dem aufgelösten Clara-Agenten (Phase 4 der Agent-Konsolidierung).
