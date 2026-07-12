---
name: challenge-review
version: 0.1.0
description: Challenges an idea, draft, or decision from multiple perspectives. Combines debate mode (strong pro/con and assumption stress-test) with targeted interview mode (grill-me style questions) when context is missing. Use when someone says 'challenge this', 'stress-test this', 'devil\'s advocate', 'kritisch pruefen', 'andere Perspektiven', 'grill me', or asks what speaks against a proposal.
---

# Challenge Review

Pressure-test ideas before commitment. This skill does not approve outputs.
It is a pre-review layer for stronger decisions and cleaner downstream routing.

## When to use

- Strategy, offer, positioning, proposal, claim, campaign angle, delivery plan.
- Technical architecture or implementation direction with meaningful risk.
- Any situation where confidence is high but downside of being wrong is high.

## Mode selection

1. Classify the request: `strategy`, `offer`, `content`, `technical`,
   `operational`, `personal-context`, or `unclear`.
2. If context is thin or ambiguous, run **Question mode** first.
3. If context is sufficient, run **Debate mode**.

## Question mode (adapted from grill-me)

Ask up to 5 targeted questions, one at a time. Avoid generic prompts.

Question categories:
- objective and deadline
- constraints and non-negotiables
- assumptions presented as facts
- stakeholder impact (customer, team, management, risk/compliance)
- decision trigger (what evidence would change direction)

Rules:
- Reject vague answers politely and ask for concrete examples.
- Summarize what was understood before switching to Debate mode.
- Do not write to memory or knowledge automatically.

## Debate mode

Return a compact stress-test with:

1. **Best case for the idea**
2. **Best case against the idea**
3. **Hidden assumptions** (what must be true)
4. **Perspective scan** (customer, delivery team, leadership, finance/risk)
5. **Top risks** (severity + probability + mitigation)
6. **Decision-changing questions** (unknowns that matter most)
7. **Recommendation**: `proceed`, `revise`, or `pause` with reason

## Routing notes

- Strategy-critical topics (offers, pricing, public claims, website messaging,
  ROI/compliance/automation claims, client-facing docs): run Strategy Gate via
  `atlas-strategic-advisor` after this skill.
- Technical architecture, security, scalability, or data-integrity topics:
  route to `oracle` and, where relevant, `iris-spec-architect` or
  `simon-security-audit`.

## Hard rules

- No false balance. If one side is weak, say so.
- No invented evidence. Call out missing data explicitly.
- No approval decisions. This skill only challenges and clarifies.
- Keep outputs concise and actionable.

## Changelog

- 0.1.0 - initial version combining debate and targeted perspective questions.
