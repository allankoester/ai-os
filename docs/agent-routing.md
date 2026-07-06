# Agent Routing Guide

## Default Flow

User → Danny → Subagent(s) → Danny → User

Danny should remain the central interface. Subagents are used for specialized work and should not become independent user-facing assistants.

## Common Routes

### LinkedIn Post

1. Danny classifies request as `marketing_content_workflow`.
2. Nora retrieves context if needed.
3. Ada defines angle if strategic or campaign-related.
4. Clara writes.
5. Rosa reviews.
6. Atlas checks only if strategic claims are involved.
7. Danny returns final draft and next action.

### Proposal

1. Danny classifies request as `proposal_workflow`.
2. Nora retrieves client/service context.
3. Atlas checks strategic fit.
4. Otto drafts proposal.
5. Rosa reviews.
6. Dora formats as document if requested.
7. Danny returns draft and approval status.

### Document

1. Danny classifies request as `document_workflow`.
2. Nora retrieves context.
3. Dora structures document.
4. Rosa reviews.
5. Atlas checks if external/strategic.
6. Danny returns Markdown/document-ready output.

### Image

**Kie.ai ist ausführbar — nicht bei „Package/pending" stehen bleiben.** Referenz, Key und Script sind vorhanden. Vor jeder externen Recherche IMMER zuerst `knowledge/creative/` lesen (Library + API-Referenz) — keine Websuche nach der API.

1. Danny classifies request as `image_generation_workflow` und liest `knowledge/creative/`.
2. Nora holt relevante Library-Muster + Produkt-/Brand-Kontext.
3. Vera defines visual concept (Visual Intent).
4. Noah creates model-ready prompt aus den Library-Mustern (`steadymade-image-prompt-library-v2.md`).
5. Kira **führt aus**: `python3 scripts/kie_generate.py …` (nano-banana-pro), lädt Ergebnis nach `output/creative/`.
6. Rosa reviewt Bild + Prompt.
7. Danny returns the image und Approval-Status. Externe Nutzung erst nach User-Freigabe.

**Turnkey-Ausführung (Fakten, damit keine Rückfragen nötig sind):**

- Script: `scripts/kie_generate.py` — Presets: `--preset cover` (9:16), `--preset hero` (16:9); frei: `--prompt "…" --aspect 1:1 --out <pfad>`
- API-Key: `KIE_AI_API_KEY` (bereits im Environment gesetzt; Fallback `~/.claude/kie.env`)
- API-Referenz: `knowledge/creative/kie-ai-api-reference.md`
- Modell: `nano-banana-pro` · bestätigte Ratios: `16:9` / `1:1` / `9:16` · Resolution `1K`
- Output: `output/creative/`
- Bekannte Fallen (im Script bereits gelöst): SSL via `certifi`-Kontext; Download braucht `User-Agent`-Header; temporäre CDN-URLs (`tempfile.aiquickdraw.com`) laufen schnell ab → sofort herunterladen; leerer Poll-`state` = weiter pollen (nicht als Fehler werten).

### Strategy Check

1. Danny classifies request as `strategy_review_workflow`.
2. Nora retrieves strategy context if needed.
3. Atlas evaluates.
4. Danny summarizes recommendation.
