---
name: new-project
version: 0.1.0
description: Creates a controlled intake and setup flow for new Steadymade projects using the current knowledge contract. Use when someone says 'new project', 'projekt anlegen', 'set up project', 'create project brief', or asks to register a new internal/client project.
---

# New Project

Set up a new project without creating shadow structures.

## Purpose

Standardize project intake and create a clean project brief draft in the
correct company knowledge area.

## Required inputs

- project name
- project slug (kebab-case)
- client/company or internal owner
- project type (client/internal/research/ops)
- status (`idea`, `briefing`, `draft`, `active`, `inactive`, `archived`)
- responsible person
- start date
- short description
- initial source material (if available)

If key fields are missing, ask targeted follow-up questions.

## Target location

Use the current project domains under `knowledge/company/projects/`:

- `internal/`
- `active/`
- `inactive/`

If classification is unclear, ask before writing.

## Workflow

1. Validate naming and detect conflicts (same/similar project already exists).
2. Choose the correct target folder.
3. Create a **draft project brief** (not approved by default).
4. If source material is messy or unstructured, route to `mara-setup-agent`
   before publishing to company knowledge.

## Output format

```markdown
# Project Brief: [Project Name]
Status: draft
Created: [YYYY-MM-DD]

## Core Data
- Slug: [project-slug]
- Type: [client/internal/research/ops]
- Owner: [person/team]
- Client/Company: [name or internal]
- Start Date: [date]

## Summary
[Short project description]

## Objectives
- [Objective]

## Scope (initial)
- In scope: [..]
- Out of scope: [..]

## Dependencies and Risks
- [Risk/dependency]

## Open Questions
- [Question]

## Initial Sources
- [Source path/reference]

## Next Step
[Immediate action + owner]
```

## Hard rules

- Do not create legacy `WORKSTATIONS/` or `BRAIN/KERN` structures.
- Do not mark project artifacts as approved without explicit user approval.
- Do not invent client/project details.
- Keep draft status until reviewed.

## Changelog

- 0.1.0 - initial adapted version for Steadymade AI OS.
