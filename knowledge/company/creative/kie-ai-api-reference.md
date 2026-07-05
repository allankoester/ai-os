# Kie.ai API Reference

Aus der Produktionserfahrung im Marketing Studio (content-creator, `src/server/image.ts`).

---

## Eckdaten

- **Base URL:** `https://api.kie.ai/api/v1`
- **Auth:** `Authorization: Bearer <KIE_AI_API_KEY>` auf jedem Request
- **Env Variable:** `KIE_AI_API_KEY` (ist im Environment gesetzt)
- **Confirmed working model:** `nano-banana-pro`
- **Async pattern:** Submit → taskId → Poll bis fertig

---

## Endpoint 1 — Job erstellen

**POST** `/jobs/createTask`

```json
{
  "model": "nano-banana-pro",
  "input": {
    "prompt": "Full image generation prompt",
    "resolution": "1K",
    "aspect_ratio": "16:9",
    "output_format": "jpg",
    "image_input": ["https://..."]
  }
}
```

| Feld | Wert | Notiz |
|---|---|---|
| `model` | `nano-banana-pro` | Einziges bestätigtes Modell |
| `input.resolution` | `"1K"` | Bestätigt funktionstüchtig |
| `input.aspect_ratio` | `"16:9"` / `"1:1"` / `"9:16"` | Alle bestätigt |
| `input.output_format` | `"jpg"` | Bestätigt; `"png"` wahrscheinlich auch |
| `input.image_input` | `["https://..."]` | Optional — für Image-to-Image Editing |

**Erfolgs-Response:**
```json
{
  "code": 200,
  "msg": "success",
  "data": { "taskId": "4e5a85e71d703189550045f13b594933" }
}
```

Fehler erkennen: `code !== 200`. Fehlermeldung in `msg`.

---

## Endpoint 2 — Status pollen

**GET** `/jobs/recordInfo?taskId=<taskId>`

```json
{
  "data": {
    "state": "success",
    "resultJson": "{\"resultUrls\":[\"https://tempfile.aiquickdraw.com/...\"]}",
    "failMsg": null
  }
}
```

| State | Bedeutung |
|---|---|
| `"success"` | Fertig — URL aus `resultJson.resultUrls[0]` extrahieren |
| `"fail"` | Fehlgeschlagen — `failMsg` lesen |
| anderes | Noch in Bearbeitung — weiter pollen |

**Wichtig:** `resultJson` kann JSON-String oder bereits gepartes Objekt sein — beide Fälle behandeln.

---

## Polling-Strategie

- **Typische Generierungszeit:** 25–35 Sekunden
- **Poll-Intervall:** 3 Sekunden
- **Max. Versuche:** 50 (= 150s Timeout)
- **Output-URLs:** `tempfile.aiquickdraw.com` — **temporär**, TTL unbekannt, sofort herunterladen wenn Persistenz nötig

---

## Aspect Ratio Mapping (Channel → Format)

| Channel | Aspect Ratio |
|---|---|
| LinkedIn | `16:9` |
| Instagram | `1:1` |
| Email | `16:9` |
| Default / Fallback | `1:1` |
| Story / Hochformat | `9:16` |

---

## Image-to-Image Editing

`image_input` mit einer https-URL übergeben. Prompt muss das **vollständige Zielresultat** beschreiben — nicht nur das Delta.

```json
{
  "model": "nano-banana-pro",
  "input": {
    "prompt": "Full description of the desired result",
    "image_input": ["https://source-image.jpg"],
    "resolution": "1K",
    "aspect_ratio": "16:9",
    "output_format": "jpg"
  }
}
```

**Wichtig:** Kie.ai kann keine `data:`-URLs als `image_input` verwenden. data-URLs müssen vorher in https-URLs konvertiert werden.

---

## Prompt Engineering für nano-banana-pro

Beobachtete Stärken:
- Diagramme, UI-Mockups, Split-Scene-Kompositionen, handgezeichnete Ästhetik, abstrakte Datenviz
- Folgt Art Direction gut wenn explizite Hex-Werte und Mood-Beschreibungen angegeben sind
- Verarbeitet lange, strukturierte Prompts (3000+ Zeichen getestet)

Vermeiden:
- Text-Overlays mit spezifischen Wörtern (Rendering-Qualität variiert)
- Logos, Markenzeichen, spezifische Brand-Marks

---

## Bekannte Fallen

### Leeres `state`-Feld während der Verarbeitung

Während ein Job läuft gibt die API **keinen** `state`-Wert zurück — das Feld ist leer (`""`), nicht `"pending"` oder `"processing"`. Ein Polling-Script das auf einen bestimmten Pending-String prüft, interpretiert den Job fälschlicherweise als fertig oder fehlerhaft.

**Falsch:**
```python
if state == "pending": continue  # trifft nie zu
```

**Richtig:**
```python
if state == "success": break     # fertig
if state == "fail": break        # fehler
# alles andere (inkl. leer) → weiter pollen
```

Shell-Äquivalent:
```bash
if [ "$STATE" = "success" ]; then break; fi
if [ "$STATE" = "fail" ]; then break; fi
# kein else nötig — leerer State = noch in Arbeit
```

**Beobachtet:** Der Job mit TaskID `7b898412b5880f7994c0fbe39168f1d6` lief erfolgreich durch (~43 Sekunden), aber alle 50 Poll-Versuche gaben einen leeren State zurück weil das Script den leeren String als Abbruchbedingung behandelt hat. Die manuelle Abfrage danach zeigte `state: success` und die fertige URL.

---

## Fehlerbehandlung

- `createTask` → `code !== 200`: `msg` ausgeben
- `createTask` → kein `taskId`: als Fehler behandeln
- Poll → `state === "fail"`: `failMsg` ausgeben
- 50 Poll-Versuche erschöpft: Timeout-Fehler zurückgeben
- `resultUrls` leer trotz `success`: explizit behandeln

---

## Kira JSON-Template (Production-ready)

```json
{
  "provider": "kie.ai",
  "model": "nano-banana-pro",
  "endpoint": "https://api.kie.ai/api/v1/jobs/createTask",
  "input": {
    "prompt": "",
    "resolution": "1K",
    "aspect_ratio": "",
    "output_format": "jpg",
    "image_input": []
  },
  "polling": {
    "endpoint": "https://api.kie.ai/api/v1/jobs/recordInfo",
    "interval_ms": 3000,
    "max_attempts": 50
  },
  "metadata": {
    "project": "steadymade-ai-os",
    "department": "creative",
    "created_by": "kira",
    "library_references": [],
    "requires_review": true
  }
}
```
