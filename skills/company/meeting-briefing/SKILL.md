---
name: meeting-briefing
version: 0.1.0
description: Builds a concise, source-grounded meeting brief for client, sales, delivery, strategy, and internal meetings. Use when someone says 'meeting prep', 'prepare briefing', 'prep this call', 'what do I need for this meeting', 'meeting vorbereiten', or asks for a one-page brief.
---

# Meeting Briefing

Create a practical one-page briefing before important meetings.

## When to use

- Client calls, workshops, proposal meetings, kickoffs, reviews, retros.
- Internal decision meetings that need context and clear outcomes.

## Inputs to confirm

- meeting title and objective
- date/time and format
- participants and roles
- desired outcome (decision, alignment, update, next step)

If any are missing, ask targeted questions first.

## Workflow

1. **Collect source context**
   - Retrieve relevant company/project context via `nora-knowledge-agent`.
   - If participant/company interaction history matters and CRM is available,
     route to `twenty-crm-sales-agent` for read-only context.
2. **Assemble the brief** from confirmed facts only.
3. **Call out gaps** explicitly where context is missing.

## Output format

```markdown
# Meeting Brief: [Title]
Date/Time: [..]
Format: [..]
Objective: [..]

## Participants
- [Name] - [Role] - [Relevant context]

## Current Status
[What matters now]

## Relevant Decisions and Commitments
- [Decision/commitment + source]

## Open Questions
- [Question]

## Risks or Sensitivities
- [Risk] - [Why it matters]

## Proposed Agenda
1. [Item]
2. [Item]
3. [Item]

## Desired End State
[What should be decided, aligned, or assigned]

## Missing Information
- [Gap]
```

## Hard rules

- Never invent context. If unknown, state unknown.
- Keep it concise and actionable.
- Do not write to CRM or knowledge by default.
- For client-facing artifacts, follow approval logic in `CLAUDE.md`.

## Changelog

- 0.1.0 - initial adapted version for Steadymade AI OS.
