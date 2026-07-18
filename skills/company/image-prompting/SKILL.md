---
name: image-prompting
version: 0.1.0
description: Erstellt modellgerechte Bild-Prompts für Kie.ai und andere Bildmodelle — mit Library-Pflicht, Format-, Stil- und Negativ-Prompt-Regeln. Aktivieren wenn aus einem visuellen Konzept ein Image Prompt Package werden soll — oder wenn /image-prompting aufgerufen wird. Auch triggern bei "Bild-Prompt", "Image Prompt", "Prompt für Nano Banana", "Negativ-Prompt".
---

# Image Prompting

Überführt visuelle Konzepte in saubere, modellfertige Bild-Prompts. Wird von Vera (Creative Production) genutzt; ersetzt den früheren Noah-Agenten. Dieser Skill erzeugt Prompts, keine Bilder: die Ausführung läuft über den `generation-package`-Skill.

## Library-Pflicht

Vor jedem neuen Prompt die Steadymade Image Prompt Library lesen:

`knowledge/company/marketing/creative/image-prompts/steadymade-image-prompt-library-v2.md`

Relevante Kategorie und Prompt Patterns identifizieren; Stil, Struktur, Negativ-Prompt-Logik und Parameter-Muster übertragen, nie mechanisch kopieren. Verwendete Library-Referenzen immer im Output nennen.

Kategorien:

- **People / Arbeitssituationen** → `Real Human Documentary Texture` für alle Menschenbilder
- **Produkt / Tool Visuals** → `Impossible Product Shot Workflow`, `Visual Intent Document`, `Product Consistency Lock`
- **360° Product Sheet** → für Multi-View-Produktserien
- **Abstract / Systeme** → Architektur- und System-Patterns
- **LinkedIn / Website** → formatspezifische Patterns, falls vorhanden

## Prompt-Regeln

Prompts auf Englisch (außer explizit anders gewünscht). Ein guter Prompt ist: spezifisch, visuell, nicht generisch, produktionsreif, klar in Komposition und Stimmung, im Steadymade-Look.

Vermeiden: "AI brain", "futuristic robot", "neon cyberpunk", "glowing network", "corporate stock photo", zufällige Tech-Abstraktion, Fake-Text im Bild (außer explizit gefordert).

### Menschenbilder

- `Real Human Documentary Texture` anwenden.
- Alter, Hautton, Lichtquelle, Pose, Hintergrund konkret definieren, nie generische Platzhalter.
- Realistische Haut, natürliches Licht, unpolierte Arbeitssituationen, Anti-AI-Look.

### Produktbilder

- Kein Produkt-Prompt ohne Visual Intent Document oder klares Produkt-Briefing.
- `Product Consistency Lock`: Silhouette, Proportionen, Designdetails, Materialtextur, Farbe/Finish, nur verifizierte Logo-Platzierung.
- Nie Produktfeatures, Branding oder Varianten erfinden. Konsistenz über Variationen nicht garantieren, als Risiko markieren.

## Output-Format

```markdown
### Image Prompt Package

**Library References Used:** [Kategorie / Pattern-Namen]
**Use Case:** [Kanal, Zweck, Kontext]
**Recommended Model Route:** Kie.ai nano-banana-pro / andere
**Aspect Ratio:** [16:9 / 4:5 / 1:1 / ...]
**Main Prompt:** [englischer Produktions-Prompt]
**Negative Prompt:** [use-case-spezifisch, nie generisch]
**Parameters:** model / aspect_ratio / output_count / quality / seed / additional_settings
**Adaptation Notes:** [welche Patterns wie adaptiert wurden]
**Risks / Watchouts:** [was bei/nach Generierung zu prüfen ist]
```

## Regeln

- Nie behaupten, ein Bild sei generiert worden; dieser Skill endet beim Prompt-Paket.
- Library-Referenzen und Adaptation Notes sind Pflichtfelder; ohne sie lehnt der `generation-package`-Schritt ab.
- Visuelle Sprache statt Strategie-Jargon.
- Ton- und Sprachregeln für Begleittexte: `operating-profile.md` § Sprache & Ton.

## Changelog

- 0.1.0 (2026-07-18): Initiale Version — überführt aus dem aufgelösten Noah-Agenten (Phase 3 der Agent-Konsolidierung).
