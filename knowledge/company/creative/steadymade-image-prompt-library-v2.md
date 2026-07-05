# Steadymade Image Prompt Library

Referenz-Prompts für Noah.

Diese Library sammelt getestete und gute Bildprompts für Steadymade. Sie dient nicht als Copy-Paste-Sammlung, sondern als Musterbibliothek: Noah liest erfolgreiche Prompts, erkennt Struktur, Stil, Gewichtung und Bildlogik und überträgt diese Muster auf neue Aufgaben.

Jeder Eintrag sollte nachvollziehbar machen:

- wofür der Prompt eingesetzt wurde
- mit welchem Modell er funktioniert hat
- welche Parameter genutzt wurden
- was am Ergebnis stark war
- worauf Noah beim Adaptieren achten soll

---

## Nutzung durch Noah

Noah nutzt diese Library, bevor neue Bildprompts erstellt werden.

Noah soll:

- erfolgreiche Muster erkennen und übertragen
- Prompts nicht direkt kopieren, außer der User fordert es ausdrücklich
- Stil, Struktur, visuelle Logik und Gewichtung aus guten Beispielen ableiten
- negative Prompts immer passend zum neuen Use Case anpassen
- leere Kategorien ignorieren
- bei ähnlichen Use Cases die besten Referenzprompts berücksichtigen
- bei neuen starken Ergebnissen einen neuen Library-Eintrag vorschlagen

Noah soll nicht:

- Prompts mechanisch wiederholen
- alte Prompts ohne Anpassung für neue Aufgaben verwenden
- Stilreferenzen ungeprüft mischen
- Modellparameter erfinden, wenn sie unbekannt sind
- generische Negative Prompts blind übernehmen

---

## Struktur eines Eintrags

```markdown
### [Titel / Use Case]

**Status:** getestet / vielversprechend / experimentell  
**Einsatz:** [Wo/wofür wurde das Bild verwendet]  
**Kategorie:** [z. B. LinkedIn Visual, Website Hero, Workshop Slide]  
**Modell:** [z. B. Nano Banana / Kie.ai-Modell / anderes Modell]  
**Aspect Ratio:** [z. B. 16:9, 4:5, 1:1]  
**Output-Ziel:** [z. B. Hero Image, LinkedIn Post, Präsentationsgrafik, Tool Visual]  
**Stilrichtung:** [z. B. editorial, documentary, abstract system, product UI, cinematic realism]  
**Tags:** [z. B. workflow, architecture, human-in-control, dashboard, AI operations]

**Prompt:**
[Prompt-Text]

**Negative Prompt:**
[Negative Prompt]

**Parameter / Settings:**
- aspect_ratio:
- output_count:
- quality:
- seed:
- additional_settings:

**Was funktioniert hat:**
[Kurze Notiz: Was macht diesen Prompt stark? Bildlogik, Komposition, Tonalität, Detailgrad, Modellverhalten.]

**Worauf Noah achten soll:**
[Wie soll Noah dieses Muster adaptieren? Was darf nicht kopiert werden? Welche Elemente sind übertragbar?]

**Wann nicht verwenden:**
[Falls relevant: Für welche Use Cases ist dieser Prompt ungeeignet?]

**Referenz / Ergebnis:**
[Optional: Dateiname, Link, Screenshot-Notiz oder Beschreibung des Ergebnisses]
```

---

## Qualitätskriterien für neue Einträge

Ein Prompt sollte nur in diese Library aufgenommen werden, wenn mindestens drei der folgenden Punkte erfüllt sind:

- Das Ergebnis passt sichtbar zur Steadymade-Ästhetik.
- Die Bildidee unterstützt das Verständnis, statt nur dekorativ zu wirken.
- Das Modell hat die Komposition zuverlässig umgesetzt.
- Der Prompt ist klar strukturiert und wiederverwendbar.
- Der Stil ist nicht generisch oder stockig.
- Das Ergebnis wirkt nicht offensichtlich nach AI-Klischee.
- Der Prompt enthält sinnvolle Begrenzungen und vermeidet visuelle Fehler.
- Die Negative Prompts verbessern das Ergebnis nachvollziehbar.
- Der Prompt lässt sich für ähnliche Use Cases adaptieren.

---

## Globale Steadymade-Bildregeln

Steadymade-Bilder sollten bevorzugt wirken:

- ruhig
- präzise
- operativ
- hochwertig
- editorial
- modern
- systemisch
- nicht dekorativ
- nicht laut
- nicht generisch

Vermeiden:

- glowing AI brains
- Roboterhände
- Cyberpunk-Neon
- beliebige Netzwerk-Linien
- futuristische Stockfoto-Büros
- übertriebene Sci-Fi-Ästhetik
- generische Business-Menschen mit Tablets
- Fake-Text im Bild
- zu viele Icons
- überladene Kompositionen
- sterile Corporate-Stockfoto-Optik

---

## LinkedIn Visuals

*(Noch leer — erste Beispiele hier eintragen)*

---

## Website / Hero Images

*(Noch leer — erste Beispiele hier eintragen)*

---

## Workshop / Präsentation

*(Noch leer — erste Beispiele hier eintragen)*

---

## Produkt / Tool Visuals

### Impossible Product Shot Workflow — Visual Intent First

**Status:** vielversprechend / Pattern  
**Einsatz:** KI-gestützte Produktvisuals, Packshots, Kampagnenmotive, E-Commerce-Assets, Tool-Visuals, 360° Produktvariationen  
**Kategorie:** Produkt / Tool Visuals  
**Modell:** Nano Banana / Kie.ai / Gemini Flash Image / je nach Setup  
**Aspect Ratio:** flexibel, abhängig vom Output; typisch 1:1 für Packshots, 4:5 für Social, 16:9 für Hero/Präsentation  
**Output-Ziel:** Konsistente Produktbilder mit kontrollierter Bildidee, Produktidentität, Lichtführung, Materialität und finaler Qualitätsprüfung  
**Stilrichtung:** high-end product photography, controlled realism, e-commerce consistency, campaign product visual  
**Tags:** product photography, visual intent, consistency, packshot, 360 product sheet, inpainting, upscale, product lock, e-commerce, campaign visual

**Prompt:**

Dies ist kein einzelner Copy-Paste-Prompt, sondern ein mehrstufiges Prompt-System. Noah soll diesen Eintrag als Workflow-Muster nutzen.

```text
Phase 1 — Visual Intent Document
Analyze the client brief, moodboard, product reference and intended use before generating an image. Extract a complete visual direction: emotional core, visual influences, color palette, lighting setup, composition structure, textures, materials, scale, perspective, realism level and product consistency requirements.

Phase 2 — Product Consistency Lock
Create a product image prompt that preserves silhouette, proportions, product variant, material texture, color, finish, logo placement only if verified, and key design details. Allow changes only to camera angle, lighting, background, shadow, reflection, controlled perspective and composition.

Phase 3 — Controlled Generation
Generate a broad set of image variations based on the approved Visual Intent Document. Keep the product identity stable. Vary only composition, environment, light direction and campaign atmosphere within the defined constraints.

Phase 4 — Refinement
Select the strongest output and refine narrowly: clean artifacts, improve edges, correct color drift, improve material realism, remove unwanted text, repair distorted details, upscale only after the composition is approved.
```

**Negative Prompt:**

```text
wrong product shape, changed silhouette, mixed product variants, invented logo, wrong logo placement, fake branding, fake typography, inaccurate materials, wrong colors, feature hallucination, distorted packaging, warped edges, broken geometry, inconsistent scale, unrealistic reflections, overdramatic lighting, overprocessed CGI, plastic render, cheap stock-photo look, random background objects, fake text, watermark, low resolution, blurry product details, malformed product, inconsistent views, visual drift between variations
```

**Parameter / Settings:**
- aspect_ratio: 1:1 / 4:5 / 16:9 depending on use case
- output_count: 4–8 for exploration, 1–2 for refinement
- quality: high
- seed: optional, useful for controlled iteration
- additional_settings: use image reference / product reference if available; use editing/inpainting mode for refinements; use upscaling only after image selection

**Was funktioniert hat:**

Der Ansatz trennt kreative Richtung, Produktkonsistenz und finale Bildausgabe sauber voneinander. Dadurch wird Bildgenerierung weniger zufällig und besser wiederholbar. Der wichtigste Hebel ist das Visual Intent Document vor dem eigentlichen Prompting: Erst wird die visuelle Absicht strukturiert, dann wird generiert.

**Worauf Noah achten soll:**

Noah soll bei Produktbildern nicht sofort einen Bildprompt schreiben. Zuerst muss er entweder ein Visual Intent Document anfordern oder selbst aus Briefing, Moodboard und Produktreferenz ableiten. Danach erstellt Noah ein Prompt Package mit Produktdetails, Licht, Komposition, Materialität, Kamera, Negative Prompt und Konsistenzregeln.

Wenn Webzugriff oder externe Produktrecherche nicht verfügbar ist, darf Noah keine offiziellen Produktdetails behaupten. Dann muss er mit dem vorhandenen Referenzmaterial arbeiten und fehlende Informationen markieren.

**Wann nicht verwenden:**

Nicht geeignet für schnelle Moodbilder ohne Produktreferenz, abstrakte Systemvisuals, reine Editorial-Illustrationen oder einfache Social-Grafiken. Der Workflow lohnt sich vor allem bei hochwertigen Produkt-, Kampagnen- und E-Commerce-Bildern.

**Referenz / Ergebnis:**

Pattern basiert auf dem Prinzip: `Visual Intent before Prompting`. Ziel ist ein reproduzierbarer Prozess für kontrollierte AI Product Photography.

---

## Architektur / Systeme / Workflows

*(Noch leer — erste Beispiele hier eintragen)*

---

## Menschen / Arbeitssituationen

### Documentary Smartphone Portrait — Real Human Texture

**Status:** getestet / Master Template  
**Einsatz:** Realistische Menschenbilder für Arbeitssituationen, Founder-Portraits, Workshop-Kontext, Beratungssituationen, authentische Social-/Website-Visuals  
**Kategorie:** Menschen / Arbeitssituationen  
**Modell:** Nano Banana / Kie.ai-Modell  
**Aspect Ratio:** flexibel, empfohlen: 4:5 für Social Portraits, 16:9 für Website-/Editorial-Kontext  
**Output-Ziel:** Authentisches, unpoliertes People Image mit realistischer Haut, natürlichem Licht und glaubwürdigem Smartphone-/Documentary-Look  
**Stilrichtung:** realistic documentary photography, smartphone realism, unretouched human texture  
**Tags:** people, documentary, smartphone, realism, skin texture, human, unpolished, portrait, work situation

**Prompt:**

```text
[SHOT TYPE & AGE / GENDER] portrait of [age-year-old subject, skin tone / ethnicity], captured as a realistic documentary-style photograph, focusing on [KEY DETAILS: skin, age, emotion, texture], with [FOCAL AREAS: face / hands / eyes / specific body part], against a [BACKGROUND: simple, real-world background].

Hyper-detailed realism with [SKIN DETAILS: pores, texture, wrinkles, dryness, oil, imperfections], [HAIR DETAILS: facial hair, baby hairs, stray hair, texture], and [BONE / MUSCLE STRUCTURE: jawline, cheekbones, anatomy visibility]. [EXPRESSION / POSE: neutral, smiling, relaxed, unposed].

Natural [LIGHT DIRECTION: window light / side light / ambient daylight] designed to reveal texture, not hide it. Neutral color science, realistic contrast, no artificial smoothing or beauty correction.

Shot on [LENS: iPhone / 50–85mm / macro], realistic depth of field. Photographed in a [CAMERA FEEL: smartphone photography], at [CAMERA LEVEL: eye level / slight up / extreme close-up], with organic sharpness, micro-contrast, slight digital grain, and natural color rendering.

The image should feel real, imperfect, human, and unretouched — like a genuine smartphone photo, not AI-generated, not polished.
```

**Negative Prompt:**

```text
AI-looking face, plastic skin, beauty retouching, airbrushed skin, overly smooth skin, waxy texture, CGI, 3D render, fashion editorial polish, fake pores, symmetrical perfect face, glossy commercial lighting, unrealistic eyes, over-sharpened details, fake smile, generic stock photo, corporate stock photography, overprocessed HDR, unnatural skin tone, distorted hands, extra fingers, malformed anatomy, artificial background blur, fake text, watermark, logo
```

**Parameter / Settings:**
- aspect_ratio: 4:5 / 16:9 / 1:1 depending on use case
- output_count: 2–4
- quality: high
- seed: optional
- additional_settings: prefer realistic / documentary / natural light settings where available

**Was funktioniert hat:**

Der Prompt zwingt das Modell weg von polierter AI-Ästhetik und hin zu glaubwürdiger dokumentarischer Fotografie. Stark ist vor allem die Kombination aus konkreten Hautdetails, natürlichem Licht, Smartphone-Feeling, unperfekter Pose und klarer Negativabgrenzung gegen Beauty-Retusche, CGI und Stockfoto-Look.

**Worauf Noah achten soll:**

Noah soll dieses Muster vor allem für authentische Menschenbilder nutzen. Die Platzhalter müssen immer konkret ausgefüllt werden. Besonders wichtig sind Alter, Lichtquelle, Kamera-Level, Hintergrund und emotionale Haltung. Nicht blind alle Hautdetails übernehmen, sondern passend zur Person und Situation dosieren.

Für Steadymade sollte Noah den Prompt stärker auf reale Arbeitssituationen adaptieren: Beratungsgespräch, Workshop, konzentrierter Blick auf Laptop, Hände an Whiteboard, ruhiger Büroraum, dokumentarischer Moment. Kein künstliches Business-Portrait.

**Wann nicht verwenden:**

Nicht geeignet für stark stilisierte Editorials, abstrakte Systemvisuals, Produktgrafiken, UI-Mockups, Architekturdiagramme oder bewusst grafische Markenbilder.

**Referenz / Ergebnis:**

Master Template für realistische People-Visuals mit dokumentarischem Smartphone-Look.

---

## Angebote / Sales Documents

*(Noch leer — erste Beispiele hier eintragen)*

---

## Abstract / Conceptual Visuals

*(Noch leer — erste Beispiele hier eintragen)*

---

## Prompt Patterns

Dieser Bereich sammelt keine vollständigen Prompts, sondern wiederverwendbare Muster.

### Grundarchitektur: 4-Layer Prompt

Aus der Produktionserfahrung im Marketing Studio. Jeder starke Bildprompt hat diese vier Schichten:

```
Layer 1 — Brand Layer       → Wie fühlt sich das Bild an?
Layer 2 — Image Type Layer  → Wie wird das Bild gerendert?
Layer 3 — Content Layer     → Was ist sichtbar?
Layer 4 — Output Layer      → Größe, Format, Einschränkungen
```

**Master Template:**

```text
Create one [format] image for [use case].

## Brand Layer
- Primary color: [Hex]
- Accent color: [Hex]
- Supporting colors: [Hex, Hex]
- Typography style: bold geometric sans-serif for headlines and labels, similar to Space Grotesk — strong optical weight, slightly condensed, low stroke contrast, no humanist curves; monospace for tags and category labels, similar to JetBrains Mono — clean, technical, uppercase-friendly; body text in a neutral geometric sans, similar to Plus Jakarta Sans — readable, modern, no decorative details
- Mood / brand voice: [2–4 Adjektive]
- Layout style: [minimal / structured / editorial / ...]
- Composition density: [low / medium / high]
- Exclusions: [was ausdrücklich nicht erscheinen soll]

## Image Type Layer
- Image type: [sketch / diagram / editorial illustration / flat vector / isometric / UI mockup / photorealistic]
- Rendering style: [hand-drawn / vector / cinematic / documentary / ...]
- Line quality: [clean / irregular / marker / crisp]
- Detail level: [low / medium / high]
- Shading: [none / minimal / realistic]
- Background: [clean white / dark / brand color / environmental]
- Perspective: [flat 2D / isometric / eye level / bird's eye]
- Finish quality: [rough / polished / high-resolution]

## Content Layer
- Main idea: [Kernaussage des Bildes in einem Satz]
- Primary subject: [Hauptelement]
- Secondary elements: [2–4 Unterstützungselemente]
- Layout: [left-to-right / centered / split-scene / ...]
- Labels / short text: [max 3–5 Wörter pro Label, wenn überhaupt]
- Focal point: [was der Betrachter in 2 Sekunden sehen soll]
- Information density: [max. 4–6 Hauptelemente]
- Avoid: [konkret benennen was nicht passieren soll]

## Output Layer
- Aspect ratio: [16:9 / 1:1 / 4:5 / 9:16]
- Use case: [LinkedIn / Instagram / Website Hero / Präsentation / ...]
- Text usage: [none / short labels only / headline allowed]
- Brand restrictions: no logos, no watermarks, no company names as text
- Quality bar: [high-resolution, sharp, modern finish]
- Exclusions: [zusätzliche Ausschlüsse]
```

**Short Formula (für einfachere Aufgaben):**
```text
[Goal] + [Brand Layer] + [Image Type Layer] + [Content Layer] + [Output Rules]
```

**Empfohlene Informationsdichte für LinkedIn:**
- 1 Hauptbotschaft
- 1 Focal Point
- 3–5 unterstützende Elemente
- 0–5 kurze Labels
- 1 klare Leserichtung

Wenn der Prompt mehr braucht → Konzept auf mehrere Bilder aufteilen.

---

### Image Types — Übersicht

| Type | Wofür | Nicht für |
|---|---|---|
| **Editorial Illustration** | Abstrakte Konzepte, Metaphern, narrative Momente | Diagramme, Strukturvergleiche, saubere Icons |
| **Sketch** | Workshop-Feeling, Consultant-Kontext, Prozessdarstellungen | Polierte Brand-Assets, finale Produktionsbilder |
| **Diagram** | Flows, Strukturen, Vergleiche, Infografiken | Fotorealismus, emotionale Bilder |
| **Flat Vector** | Saubere Icons, Brand-Assets, strukturierte Layouts | Handgezeichnete Optik, Fotorealismus |
| **Isometric** | Systeme, Architektur, technische Setups | Einfache 2D-Konzepte, People-Bilder |
| **UI Mockup** | App-Screens, Dashboard-Visuals, Interface-Demos | Ohne klaren Produktkontext |
| **Statement** | Text-fokussierte Visuals, Quotes, Typo-Bilder | Bildlastige Konzepte |
| **Photorealistic** | People, Arbeitssituationen, Produktfotos | Abstrakte Konzepte, Systemdiagramme |

---

### Editorial Illustration — Kerneigenschaften

Aus `docs/image-types/editorial-illustration.md` im Marketing Studio:

- Figurativ und metaphorisch — reduziert, ikonisch, grafisch stark
- Eine starke visuelle Metapher, keine Informationsstruktur
- Leicht asymmetrisch, mild verformt, erkennbar handgezeichnet
- Nur Flat Surfaces — keine Verläufe, kein Glanz, kein 3D
- Stark negative Raumnutzung — eine Idee, nicht viele konkurrierende Elemente

**Negative Prompt für Editorial Illustration:**
```text
photorealism, soft 3D rendering, glossy startup illustration, perfect geometric icons, gradients, shadows, textures, decorative effects, drop shadows, symmetric cheerful characters, pastel stock art, corporate clipart
```

### Komposition

*(Noch leer)*

### Licht / Stimmung

*(Noch leer)*

### Material / Oberfläche

*(Noch leer)*

### System- und Workflow-Metaphern

*(Noch leer)*

### Menschen / Documentary Realism

#### Pattern: Real Human Documentary Texture

**Zweck:** Menschen glaubwürdig, unretuschiert und nicht AI-glatt darstellen.

**Übertragbare Muster:**

- konkrete Hautdetails nennen: pores, wrinkles, dryness, oil, imperfections
- natürliche Lichtquelle definieren: window light, side light, ambient daylight
- Kamera-Charakter festlegen: smartphone photography, organic sharpness, slight digital grain
- Perfektion aktiv ausschließen: no artificial smoothing, no beauty correction
- Pose uninszeniert halten: relaxed, neutral, unposed
- Hintergrund real und einfach halten

**Typische Bausteine:**

```text
realistic documentary-style photograph
natural window light designed to reveal texture, not hide it
organic sharpness, micro-contrast, slight digital grain
real, imperfect, human, unretouched
not AI-generated, not polished
```

**Risiko:**

Zu viele Detailbegriffe können bei manchen Modellen überzeichnete Haut oder unvorteilhafte Makro-Details erzeugen. Für Business-Kontexte Details dosieren.

### Produkt / Tool Visuals

#### Pattern: Visual Intent Document

**Zweck:** Vor der Bildgenerierung eine vollständige visuelle Richtung extrahieren. Das verhindert zufälliges Prompting und macht Produktbilder steuerbarer.

**Felder:**

- Emotional Core: Welche Stimmung, welches Gefühl, welche Markenwirkung?
- Visual Influences: Welche Referenzen, Stilrichtungen, Kampagnenlogiken?
- Color Palette: Hauptfarben, Akzentfarben, Kontrastniveau, Sättigung.
- Lighting Setup: Lichtquelle, Richtung, Härte, Schatten, Reflexionen.
- Composition Structure: Framing, Bildaufbau, Vordergrund, Hintergrund, Negativraum.
- Texture / Materiality: Oberflächen, Stofflichkeit, Glanzgrad, Patina, Kanten.
- Scale / Perspective: Produktgröße, Kameraabstand, Blickwinkel, Perspektive.
- Subject Realism Level: Foto, Render, Studio, dokumentarisch, hyperreal.
- Product Consistency Requirements: Welche Details dürfen sich nicht verändern?
- Negative Visual Constraints: Was darf ausdrücklich nicht passieren?

**Typische Bausteine:**

```text
Before writing the final image prompt, extract the complete visual intent from the brief and reference material. Define emotional core, visual influences, palette, lighting, composition, materiality, scale, perspective, realism level and product consistency requirements.
```

**Worauf Noah achten soll:**

Noah soll dieses Pattern immer nutzen, wenn Produktidentität, Kampagnenqualität oder visuelle Präzision wichtig sind. Bei einfachen Moodbildern reicht eine Kurzversion.

---

#### Pattern: Product Consistency Lock

**Zweck:** Produktdetails bei mehreren Bildvarianten möglichst stabil halten.

**Zu bewahren:**

- silhouette
- proportions
- product variant
- design details
- material texture
- color / finish
- logo placement, only if verified
- packaging shape
- key functional elements

**Erlaubte Änderungen:**

- camera angle
- controlled perspective
- lighting refinement
- background
- shadow
- reflection
- composition
- environment, if consistent with the brief

**No-Gos:**

- invented branding
- mixed product variants
- wrong logo placement
- shape drift
- color drift
- fake features
- wrong material
- packaging distortion

**Typische Bausteine:**

```text
Preserve the exact product silhouette, proportions, product variant, material texture, colors, finish and verified logo placement. Only change camera angle, lighting, background, shadow, reflection and controlled composition. Do not invent branding, features or variants.
```

**Risiko:**

Produktkonsistenz ist modellabhängig. Noah darf keine perfekte Übereinstimmung garantieren. Bei Markenprodukten immer Referenzbilder oder offizielle Produktinformationen nutzen, wenn verfügbar.

---

#### Pattern: 360° Product Sheet

**Zweck:** Aus einem Produktreferenzbild eine konsistente Serie oder ein Sheet mehrerer Ansichten vorbereiten.

**Typische Struktur:**

- Front view
- 3/4 front view
- side view
- 3/4 back view
- back view
- detail close-up
- material close-up
- packaging / context view

**Typische Bausteine:**

```text
Create a consistent product view sheet showing the same exact product from multiple controlled angles. Keep scale, horizon, lighting, shadow, material and color consistent across all views. Between views, only the rotation and camera angle may change.
```

**Worauf Noah achten soll:**

Für echte 360°-Sequenzen ist strenge Konsistenz schwer. Als Steadymade-Standard lieber zunächst ein Product View Sheet mit wenigen kontrollierten Ansichten anlegen, statt sofort 24 perfekte Turntable-Frames zu erwarten.

---

#### Pattern: Generate Broad, Refine Narrow

**Zweck:** Erst Variantenraum öffnen, dann gezielt verengen.

**Ablauf:**

1. 4–8 Varianten mit gleicher Visual Intent erzeugen.
2. Eine Richtung auswählen.
3. Nur noch gezielt verbessern: Material, Licht, Kanten, Hintergrund, Artefakte.
4. Erst nach Auswahl upscalen oder finalisieren.

**Typische Bausteine:**

```text
Generate several controlled variations from the same visual intent. Keep product identity locked. Vary only composition, lighting mood and environment. After selection, refine narrowly instead of changing the concept.
```

**Risiko:**

Zu frühes Upscaling verschwendet Zeit. Zu viele gleichzeitige Änderungen zerstören Konsistenz.

### Negative-Prompt-Bausteine

#### People / Documentary Realism

```text
AI-looking face, plastic skin, beauty retouching, airbrushed skin, overly smooth skin, waxy texture, CGI, 3D render, fashion editorial polish, fake pores, symmetrical perfect face, glossy commercial lighting, unrealistic eyes, over-sharpened details, fake smile, generic stock photo, corporate stock photography, overprocessed HDR, unnatural skin tone, distorted hands, extra fingers, malformed anatomy, artificial background blur, fake text, watermark, logo
```

#### Product Consistency / AI Product Photography

```text
wrong product shape, changed silhouette, mixed product variants, invented logo, wrong logo placement, fake branding, fake typography, inaccurate materials, wrong colors, feature hallucination, distorted packaging, warped edges, broken geometry, inconsistent scale, unrealistic reflections, overdramatic lighting, overprocessed CGI, plastic render, cheap stock-photo look, random background objects, fake text, watermark, low resolution, blurry product details, malformed product, inconsistent views, visual drift between variations
```

---

## Hinweise für Pflege

Neue Prompts sollten nicht einfach eingefügt werden. Vor dem Eintrag prüfen:

1. Ist der Use Case klar?
2. Ist das Modell genannt?
3. Ist das Ergebnis wirklich gut oder nur zufällig interessant?
4. Ist beschrieben, was funktioniert hat?
5. Kann Noah daraus ein Muster ableiten?
6. Gibt es Hinweise, wann der Prompt nicht geeignet ist?

Wenn Informationen fehlen, den Eintrag mit `Status: experimentell` markieren.
