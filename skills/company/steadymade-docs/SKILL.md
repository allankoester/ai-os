---
name: steadymade-docs
version: 0.1.0
description: Erstellt professionelle, druckfertige Dokumente im Steadymade.ai Brand-System — als Markdown, HTML und PDF. Aktivieren wenn der User ein Anschreiben, Angebot, Report, Brief, One-Pager oder sonstiges Schriftstück für Steadymade.ai braucht — oder wenn er /steadymade-docs aufruft. Auch triggern wenn der User sagt "schreib mir einen Brief", "erstell ein Angebot", "ich brauche ein Dokument", "mach mir einen One-Pager" im Kontext von Steadymade.ai oder Kundenkommunikation.
---

# Steadymade Docs

**Was dieser Skill tut:** Nimmt eine Aufgabe (Anschreiben, Angebot, Report, Brief, One-Pager) → sammelt die nötigen Infos → generiert drei Ausgabedateien: **MD** (Inhalt, editierbar), **HTML** (gestylt, druckfertig) und **PDF** (via Script).

---

## Ablauf

1. **Dokumenttyp klären** — falls nicht klar aus dem Kontext, frage einmal kompakt:
   - Was für ein Dokument? (Anschreiben / Angebot / Report / Brief / One-Pager)
   - An wen? (Name, Rolle, Organisation)
   - Worum geht es? (Kurze Inhaltsbeschreibung oder Stichpunkte)
   - Absender: Standard ist Alex Blancke — falls jemand anderes, fragen
   - Sprache: Deutsch (Standard) oder Englisch

   Stelle alle offenen Fragen **in einer Nachricht**, nicht sequenziell.

2. **Markdown speichern** — schreibe zuerst die `.md`-Datei mit dem reinen Dokumentinhalt (kein HTML, keine Styles). Sauberes Markdown für Archiv und Weiterbearbeitung.
   - Dateiname: `[typ]-[empfaenger]-[datum].md`

3. **HTML generieren und speichern** — nutze das CSS-Template und die Dokumentstruktur unten. Gleicher Dateiname mit `.html`.

4. **PDF exportieren** — führe das Export-Script aus:
   ```bash
   python3 ~/.claude/skills/steadymade-docs/scripts/export_pdf.py "[pfad-zur-html-datei]"
   ```
   Das Script erzeugt `[selber-name].pdf` im gleichen Ordner.

5. **Fertig melden** — teile alle drei Pfade mit (MD, HTML, PDF).

---

## Absender (Standard)

```
steadymade.ai
Alex Blancke
Bundesstr. 11 · 20146 Hamburg
alex.blancke@steadymade.ai · steadymade.ai
```

Alternativ Allan Köster (Sydney) oder Urs Thielecke — nur wenn explizit gewünscht.

### Steuer- & Bankdaten (Alex Blancke / steadymade.ai)

Für Rechnungen und alle Dokumente, die Zahlungs- oder Steuerangaben brauchen:

```
Steuernummer: 42 022 06463
USt-ID:       DE406095239
Bank:         Hamburger Sparkasse
IBAN:         DE56 2005 0550 1228 4983 98
BIC:          HASPDEHHXXX
```

Diese Daten gehören zur rechnungsstellenden Person Alex Blancke (Einzelunternehmen, steadymade.ai). Nicht mit SMAPAS / Allan Köster (eigene Entität, eigene Steuernummer/IBAN) vermischen — die Steuernummer muss immer zum ausgewiesenen Absender passen.

### Rechnung (Dokumenttyp)

Aufbau wie ein Angebot, plus:
- Meta-Zeile mit `Rechnungsnr.` (`SM-[JAHR]-[NR]`), `Datum`, `Leistungszeitraum`
- Leistungstabelle mit Netto → USt 19 % → (optionale Zwischensumme) → **Gesamtbetrag**
- Weiterberechnete Reisekosten (Bahn etc.) als durchlaufender Posten **nach** der USt-Zeile ohne zusätzliche USt ausweisen; auf Beleg im Anhang hinweisen
- Zahlungsziel + Rechnungsnummer im Verwendungszweck nennen
- Signatur mit Bild (`assets/signature-alex-blancke.png`, 52px Höhe)
- Fuß-Block mit Bankverbindung (links) und Steuerlichen Angaben (rechts), Mono-Labels in Grün

---

## Design System

### Farben

```
Primär-Grün (Akzent auf Light):  #148A3F  →  Links, Headlines, Akzentlinie
Primär-Grün (Button-BG Light):   #0A4D23  →  CTA-Buttons
Apricot-Akzent (Light):          #C46A38  →  zweiter Akzent, sparsam
Dark BG:                          #0B2218  →  Header-Sektion (falls Dark-Block)
Dark BG medium:                   #1A3328  →  Sekundärer Dark-Block

Weiß:       #FAFBFA   Grau-50:  #F2F4F2   Grau-100: #E4E7E4
Grau-300:   #9DA19D   Grau-500: #6E736E   Grau-700: #474B47
Grau-900:   #1C1F1D
```

### Schriften (Google Fonts CDN)

```
Space Grotesk  → Headlines (H1–H3), Logo, Buttons | weight 700, letter-spacing -0.03em
Plus Jakarta Sans → Body, Labels, Meta-Text         | weight 400/500/600, line-height 1.65
JetBrains Mono → Tags, Badges, Spaltenköpfe, Datums | weight 500, letter-spacing 0.05em, uppercase
```

### Grundregeln

- Keine dekorativen Schatten — Tiefe durch Farbe und Borders
- Border-Radius: 8px (Tags, Inputs), 12px (Cards), 100px (Pills)
- Whitespace großzügig: Sections mindestens 32px Abstand
- Akzentlinie grün unter dem Betreff: 3px, 48px breit, border-radius 100px
- Tabellen: Mono für Spaltenköpfe (uppercase, klein), kein äußerer Rahmen, nur Zeilen-Borders

---

## CSS-Template (in jedes generierte HTML einbetten)

```html
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --g600: #148A3F; --g800: #0A4D23; --g50: #E8FBF0;
  --a600: #C46A38; --a50: #FFF0E8;
  --d900: #0B2218; --d800: #1A3328;
  --white: #FAFBFA; --n50: #F2F4F2; --n100: #E4E7E4;
  --n300: #9DA19D; --n500: #6E736E; --n700: #474B47; --n900: #1C1F1D;
  --fd: 'Space Grotesk', sans-serif;
  --fb: 'Plus Jakarta Sans', sans-serif;
  --fm: 'JetBrains Mono', monospace;
}
@page { size: A4; margin: 22mm 20mm 20mm; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: var(--fb);
  font-size: 10pt;
  color: var(--n700);
  background: var(--white);
  line-height: 1.65;
  max-width: 176mm;
  margin: 0 auto;
  padding: 24mm 0 20mm;
}
/* --- Header --- */
.doc-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding-bottom: 18px; margin-bottom: 32px;
}
.doc-logo {
  font-family: var(--fd); font-weight: 700; font-size: 15pt;
  color: var(--n900); letter-spacing: -0.02em;
}
.doc-logo .logo-dot { color: var(--g600); }
.doc-logo .logo-ai  { color: var(--g600); font-weight: 500; }
.doc-tagline {
  font-family: var(--fm); font-size: 7pt; color: var(--n300);
  letter-spacing: 0.07em; text-transform: uppercase; margin-top: 3px;
}
.doc-header-right {
  text-align: right;
  font-family: var(--fm); font-size: 7.5pt; color: var(--n500);
  letter-spacing: 0.04em; line-height: 1.7;
}
/* --- Empfänger + Absenderzeile --- */
.doc-sender-line {
  font-size: 7.5pt; color: var(--n300); margin-bottom: 14px;
  border-bottom: 1px solid var(--n100); padding-bottom: 5px; width: fit-content;
}
.doc-recipient { font-size: 10pt; color: var(--n700); line-height: 1.6; }
/* --- Datum / Referenz --- */
.doc-meta-row {
  display: flex; justify-content: flex-end; gap: 28px;
  margin: 24px 0 28px;
}
.doc-meta-item { text-align: right; }
.doc-meta-label {
  font-family: var(--fm); font-size: 7pt; color: var(--n300);
  letter-spacing: 0.07em; text-transform: uppercase; display: block;
}
.doc-meta-value { font-size: 10pt; color: var(--n900); font-weight: 500; }
/* --- Betreff / Titel --- */
.doc-subject {
  font-family: var(--fd); font-size: 14pt; font-weight: 700;
  color: var(--n900); letter-spacing: -0.02em; margin-bottom: 6px;
}
.doc-subject-bar {
  width: 48px; height: 3px; background: var(--g600);
  border-radius: 100px; margin-bottom: 22px;
}
/* --- Body --- */
.doc-body { color: var(--n700); }
.doc-body p { margin-bottom: 8px; }
.doc-body p:last-child { margin-bottom: 0; }
.doc-body h2 {
  font-family: var(--fd); font-size: 11pt; font-weight: 700;
  color: var(--n900); letter-spacing: -0.02em; margin: 18px 0 5px;
}
.doc-body h3 {
  font-family: var(--fd); font-size: 9.5pt; font-weight: 600;
  color: var(--g600); margin: 13px 0 4px;
}
.doc-body ul { padding-left: 18px; margin-bottom: 8px; }
.doc-body li { margin-bottom: 3px; }
/* --- Tabelle --- */
.doc-table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 9.5pt; }
.doc-table th {
  font-family: var(--fm); font-size: 7.5pt; font-weight: 500;
  letter-spacing: 0.07em; text-transform: uppercase; color: var(--n300);
  text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--n100);
}
.doc-table td { padding: 8px 10px; border-bottom: 1px solid var(--n100); }
.doc-table td.right { text-align: right; }
.doc-table tr.subtotal td { color: var(--n500); font-size: 9pt; }
.doc-table tr.total td {
  font-family: var(--fd); font-weight: 700; font-size: 10pt;
  color: var(--n900); border-top: 2px solid var(--n900); border-bottom: none;
}
/* --- Info-Box (Briefs/Reports) --- */
.doc-infobox {
  background: var(--n50); border-left: 3px solid var(--a600);
  padding: 12px 16px; margin: 18px 0; border-radius: 0 8px 8px 0;
}
.doc-infobox p { margin: 0; font-size: 9.5pt; }
/* --- Tag/Badge --- */
.doc-tag {
  display: inline-block; font-family: var(--fm); font-size: 7.5pt;
  font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 3px 9px; border-radius: 100px;
  background: var(--g50); color: var(--g800);
}
.doc-tag.apricot { background: var(--a50); color: var(--a600); }
/* --- Signatur --- */
.doc-signature { margin-top: 36px; }
.doc-signature-greeting { margin-bottom: 28px; }
.doc-signature-name {
  font-family: var(--fd); font-weight: 700; font-size: 11pt; color: var(--n900);
}
.doc-signature-role {
  font-family: var(--fm); font-size: 7.5pt; color: var(--n300);
  letter-spacing: 0.07em; text-transform: uppercase; margin-top: 2px;
}
.doc-signature-contact {
  font-size: 8.5pt; color: var(--n500); margin-top: 6px; line-height: 1.5;
}
/* --- Footer --- */
.doc-footer {
  margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--n100);
  display: flex; justify-content: space-between;
  font-family: var(--fm); font-size: 7pt; color: var(--n300); letter-spacing: 0.05em;
}
/* --- Section titles — orphan prevention --- */
/* break-after: avoid alone is unreliable in Puppeteer/Chromium.
   Double-pin with break-before on the following .doc-body. */
.section-title {
  break-after: avoid;
  page-break-after: avoid;
  -webkit-column-break-after: avoid;
}
.subsection-title {
  break-after: avoid;
  page-break-after: avoid;
  -webkit-column-break-after: avoid;
}
.section > .doc-body {
  break-before: avoid;
  page-break-before: avoid;
  -webkit-column-break-before: avoid;
}
/* --- Print / Page-break --- */
@media print {
  html, body { background: #ffffff; padding: 0; margin: 0; }
  .doc-header, .doc-recipient, .doc-signature, .doc-footer { break-inside: avoid; }
  .doc-infobox { break-inside: avoid; }
  .doc-table { break-inside: avoid; }
  .doc-body h2, .doc-body h3 { break-after: avoid; }
  .doc-table tr { break-inside: avoid; }
  .section-title { break-after: avoid; page-break-after: avoid; }
  .subsection-title { break-after: avoid; page-break-after: avoid; }
  .section > .doc-body { break-before: avoid; page-break-before: avoid; }
  .doc-pagebreak { break-before: page; }
}
</style>
```

---

## HTML-Grundgerüst (für jedes Dokument)

```html
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[DOKUMENTTYP] — [EMPFÄNGER]</title>
[CSS-BLOCK]
</head>
<body>

<!-- HEADER -->
<div class="doc-header">
  <div>
    <div class="doc-logo">steadymade<span class="logo-dot">.</span><span class="logo-ai">ai</span></div>
    <div class="doc-tagline">Secure. Measurable. Scalable.</div>
  </div>
</div>

<!-- INHALT: je nach Dokumenttyp, siehe unten -->

<!-- FOOTER -->
<div class="doc-footer">
  <span>steadymade.ai · Alex Blancke · Bundesstr 11 · 20146 Hamburg · alex.blancke@steadymade.ai</span>
</div>

</body>
</html>
```

---

## Dokumenttypen — Inhaltsstruktur

### Anschreiben / Brief

```html
<!-- Absenderzeile (klein, grau) -->
<div class="doc-sender-line">steadymade.ai · Alex Blancke · Bundesstr 11 · 20146 Hamburg</div>

<!-- Empfänger -->
<div class="doc-recipient">
  [Vor- und Nachname]<br>
  [Rolle]<br>
  [Organisation]<br>
  [Adresse falls bekannt]
</div>

<!-- Datum -->
<div class="doc-meta-row">
  <div class="doc-meta-item">
    <span class="doc-meta-label">Hamburg,</span>
    <span class="doc-meta-value">[Datum]</span>
  </div>
</div>

<!-- Betreff -->
<div class="doc-subject">[Betreff]</div>
<div class="doc-subject-bar"></div>

<!-- Anrede + Body -->
<div class="doc-body">
  <p>Sehr geehrte/r [Anrede],</p>
  <p>[Inhalt...]</p>
</div>

<!-- Signatur -->
<div class="doc-signature">
  <div class="doc-signature-greeting"><p>Mit freundlichen Grüßen</p></div>
  <div class="doc-signature-name">Alex Blancke</div>
  <div class="doc-signature-role">AI Development, Agents & Prompt Engineering</div>
  <div class="doc-signature-contact">
    alex.blancke@steadymade.ai<br>
    steadymade.ai
  </div>
</div>
```

### Angebot

Zusätzlich zur Brief-Struktur: Angebotsnummer + Tabelle mit Leistungspositionen.

```html
<!-- Referenzzeile (nach Empfänger) -->
<div class="doc-meta-row">
  <div class="doc-meta-item">
    <span class="doc-meta-label">Angebotsnr.</span>
    <span class="doc-meta-value">SM-[JAHR]-[NR]</span>
  </div>
  <div class="doc-meta-item">
    <span class="doc-meta-label">Datum</span>
    <span class="doc-meta-value">[Datum]</span>
  </div>
  <div class="doc-meta-item">
    <span class="doc-meta-label">Gültig bis</span>
    <span class="doc-meta-value">[Datum + 30 Tage]</span>
  </div>
</div>

<!-- Leistungstabelle -->
<table class="doc-table">
  <thead>
    <tr>
      <th>Leistung</th>
      <th>Beschreibung</th>
      <th class="right">Betrag</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>[Position]</td><td>[Details]</td><td class="right">[Betrag] €</td></tr>
    <tr class="subtotal"><td colspan="2">Nettobetrag</td><td class="right">[Netto] €</td></tr>
    <tr class="subtotal"><td colspan="2">MwSt. 19 %</td><td class="right">[MwSt] €</td></tr>
    <tr class="total"><td colspan="2">Gesamtbetrag</td><td class="right">[Gesamt] €</td></tr>
  </tbody>
</table>
```

### Report / Brief

Freiere Struktur — nutze `<h2>`, `<h3>`, `<ul>`, `.doc-infobox` und `.doc-tag` je nach Inhalt.

### One-Pager

Der One-Pager braucht eine starke visuelle Hierarchie — er wird als Handout gedruckt und muss auf einen Blick überzeugen. Struktur und Vorgaben:

- **Kein Empfängerblock** — direkt nach Header: Label (Mono, grün, uppercase) → große Headline (Space Grotesk, 20–24pt) → grüne Akzentlinie
- **Grid-Layout für Inhaltskarten** — `display: grid; grid-template-columns: 1fr 1fr` für 4 Punkte oder `1fr 1fr 1fr` für 3 Punkte. Karten mit `background: var(--n50)`, `border: 1px solid var(--n100)`, `border-radius: 10px`, `padding: 16px`.
- **Mono-Label über jedem Card-Titel** — z.B. `PHASE 01 — DISCOVER` in JetBrains Mono, 7pt, grün, uppercase
- **Dark Promise-Block am Ende** — `background: var(--d900)` (dunkles Grün `#0B2218`, niemals `var(--n900)` Schwarz), `border-radius: 10px`, grüner Pfeil-Icon links, weißer Text `font-family: var(--fd)`, weight 600. Enthält das zentrale Versprechen oder den CTA.
- **Kompakter Footer** — kein Seitenabstand, direkt unter dem Promise-Block

Ziel: Auf einer A4-Seite alles untergebracht. Margins minimal (`@page { margin: 18mm }`).

---

## Qualitätsregeln

- **Kein Platzhaltertext** — immer echten, vollständigen Inhalt schreiben
- **Tone:** Direkt, pragmatisch, kompetent — wie die Brand Voice von Steadymade (kein Berater-Deutsch, kein Hype)
- **Datum:** Falls nicht angegeben, heutiges Datum verwenden
- **Angebotsnummer:** `SM-[YYYY]-[NNN]` — falls nicht vorgegeben, `SM-2026-001` als Startpunkt
- **MwSt-Hinweis:** Bei Angeboten immer Hinweis auf Kleinunternehmerregelung prüfen — falls nicht explizit anders gewünscht, 19% MwSt. ausweisen
- Das HTML muss **standalone** funktionieren — alle Styles embedded, keine externen Abhängigkeiten außer Google Fonts CDN
- **Seitenumbrüche:** `<div class="doc-pagebreak"></div>` sparsam einsetzen — aber **aktiv nutzen**, wenn ein Abschnittstitel nach dem PDF-Export am unteren Seitenende landet. Chromium/Puppeteer ignoriert `break-after: avoid` wenn die Seite zu voll ist; harter Seitenumbruch vor dem betroffenen Abschnitt ist dann die zuverlässige Lösung. Nach Abschnitten mit vielen Tabellen (Infrastruktur, Serverdetails, lange Listen) präventiv einsetzen.
- **Orphan-Prävention (Abschnittstitel):** CSS-Doppelstrategie anwenden: `break-after: avoid` + `page-break-after: avoid` auf `.section-title` UND `break-before: avoid` + `page-break-before: avoid` auf `.section > .doc-body`. Beide Regeln sowohl im normalen CSS als auch im `@media print`-Block setzen. Wenn das nicht reicht → `<div class="doc-pagebreak"></div>` vor dem betroffenen Abschnitt.
