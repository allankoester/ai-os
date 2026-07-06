# Skills Profiles (Stage 2 contract)

One YAML file per user: `profiles/<user>.yml`, created from `_template.yml`.

A profile declares which agents and skills a user runs:

- **core** — always available; Danny may route to these without asking.
- **optional** — available, but Danny mentions when routing to them.
- **excluded** — never routed to for this user (missing integrations,
  permissions, or simply out of scope for the role).

Rules:

1. Every agent in `.claude/agents/` must appear in exactly one of the three
   lists (checked by `scripts/validate.mjs`).
2. Profiles are shared team configuration — committed to git and changed via
   the normal review process (`docs/runbook-team-operations.md`).
3. Danny reads the active user's profile and never routes to excluded agents.
4. Private/personal skills that are not part of the company setup do not
   belong here — they stay in the user's local environment.
