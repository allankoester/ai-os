# Company Taxonomy Normalization - 2026-07-08

Scope:

- `AI_OS/knowledge/company/` (non-archive)

## Result

Taxonomy normalization executed with no conflicts and no missing source paths.

- operations: 34
- conflicts: 0
- missing: 0

Machine report:

- `docs/archive/ai-os-migration-2026-07-07/company-taxonomy-normalization-2026-07-08.json`

## Final canonical structure

```text
knowledge/company/
├── company_handbook_SSOT/
├── strategy/
├── commercial/
├── projects/
├── marketing/
├── contracts/
└── references/
```

## Key changes applied

1. Merged top-level commercial domains:
   - `sales/opportunities` -> `commercial/opportunities`
   - top-level `offers/` -> `commercial/offers/`
   - top-level `clients/` -> `commercial/clients/`
2. Merged top-level creative into marketing:
   - `creative/design-system` -> `marketing/creative/design-system`
   - `creative/brand-assets` -> `marketing/brand-assets`
   - image prompt library files -> `marketing/creative/image-prompts/`
3. Normalized project folders:
   - `projects/00_Internal` -> `projects/internal`
   - `projects/01_Active` -> `projects/active`
   - added `projects/inactive/`
4. Flattened contracts:
   - `contracts/legal/contracts` -> `contracts/vendor-contracts`
   - `contracts/legal/company-registration` -> `contracts/company-registration`
   - removed empty `contracts/legal`
5. Normalized references taxonomy:
   - `02_Reports_Whitepapgers` -> `reports-whitepapers`
   - `Agent Skills` -> `agent-skills`
   - `AI Strartegy Frameworks` -> `ai-strategy-frameworks`
   - `Leaders of AI - KI Assessentcenter` -> `leaders-of-ai-ki-assessment-center`
   - consolidated `04_Partner/*` into `references/partners/*`
6. Fixed known filename typos in `strategy` and `references/partners/mitarbyte/legacy/`.
7. Added missing taxonomy skeleton folders:
   - `projects/inactive/`
   - `commercial/proposals/`, `commercial/pricing/`, `commercial/sales-materials/`
   - `marketing/content/`, `marketing/channels/`
   - `contracts/client-contracts/`, `contracts/templates/`, `contracts/signed/`

## Interface alignment

Updated interface knowledge-access model to reflect taxonomy changes:

- `interface/public/data.js`
- `interface/public/app.js`

Main access model changes:

- replaced `company/offers` and `company/clients` with `company/commercial`
- replaced top-level `company/creative` access with `company/marketing`
- updated folder ordering in Knowledge view

## Cleanup

- removed `.DS_Store` files in active company tree during normalization
- removed empty legacy folders created by the move pass
