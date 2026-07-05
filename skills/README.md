# Skills Library

Skills for the Steadymade AI OS, managed via the **Skill Hub** in the operating
interface (http://localhost:4011 → Skill Hub).

```
skills/
├── company/    shared skills — committed to git, reviewed like code
└── personal/   private per-user skills — gitignored, never committed
```

## Activation (.skill-profile)

The active set lives in **`.skill-profile`** in the workspace root (gitignored,
same pattern as the KI-OS workspaces):

```
company            # scope line — the whole scope is active
+personal/foo      # activate a single skill
-company/bar       # exclude a single skill from an active scope
```

The hub materializes this profile as **symlinks** in `.claude/skills/<name>` —
that is where Claude Code discovers project skills, so active skills apply to
Danny, all subagents and scheduled jobs. Toggle in the Skill Hub UI or edit
`.skill-profile` and restart the interface. Activation is per machine/user;
the intended set is documented in `profiles/<user>.yml`.

## Marketplace

The Skill Hub browses `github.com/ComposioHQ/awesome-claude-skills` and can
install GitHub-hosted skills into `skills/personal/` (an `.install.json` notes
the origin). **Review a third-party SKILL.md before activating** — skills are
instructions for your agents. After install, adapt it via the CUSTOMIZE button.

## Skill format

One folder per skill with a `SKILL.md` (frontmatter: `name`, `description`
with trigger phrases). Optional `references/` for templates and guides.
Company skill names must be kebab-case and match their folder name
(checked by `scripts/validate.mjs`).

## Included company skills

- `company-onboarding` — guided interview that fills the company operating
  profile (custom instructions for the whole team)
- `personal-onboarding` — guided interview that creates a persona profile and
  per-user custom instructions (`CLAUDE.local.md`)
