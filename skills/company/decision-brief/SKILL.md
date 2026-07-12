---
name: decision-brief
version: 0.1.0
description: Structures important decisions into a clear brief with criteria, options, trade-offs, risks, and recommendation. Use when someone says 'help me decide', 'decision brief', 'optionen bewerten', 'pros and cons', 'should we do this', or asks for a recommendation grounded in criteria.
---

# Decision Brief

Prepare high-quality decisions before commitment.

## Decision scope

Use for strategic, commercial, operational, technical, and team decisions.

## Required clarification

Before analysis, confirm:

- exact decision statement (one sentence)
- deadline
- decision owner
- non-negotiables / constraints
- evaluation criteria

If these are missing, ask focused questions first.

## Options rule

- Evaluate at least 3 options where possible.
- Include `do nothing / defer` as a valid baseline option.

## Output format

```markdown
# Decision Brief: [Topic]
Owner: [..]
Deadline: [..]

## Decision Statement
[One-sentence decision]

## Constraints and Non-Negotiables
- [Constraint]

## Criteria
- [Criterion] - [Weight or priority]

## Options
### Option A: [Name]
Pros:
- [..]
Cons:
- [..]
Risks:
- [..]

### Option B: [Name]
...

### Option C: [Name]
...

### Option D: Do Nothing / Defer
...

## Criteria Matrix
| Option | Criterion 1 | Criterion 2 | Criterion 3 | Notes |
|---|---|---|---|---|
| A | | | | |
| B | | | | |
| C | | | | |
| D | | | | |

## Reversibility
[Easy to reverse / costly to reverse / irreversible]

## Recommendation
[Proceed with X + why]

## Confidence
[high/medium/low + why]

## Next Step
[Concrete next action and owner]
```

## Routing notes

- Strategy/public-claim/offer/pricing decisions: run Strategy Gate via
  `atlas-strategic-advisor` after this brief.
- Technical, security, scalability, or data-integrity decisions: route to
  `oracle`, and where relevant `iris-spec-architect` / `simon-security-audit`.

## Hard rules

- No recommendation without explicit criteria.
- No invented evidence; flag missing data.
- This skill structures decisions; it does not auto-approve final outcomes.

## Changelog

- 0.1.0 - initial adapted version for Steadymade AI OS.
