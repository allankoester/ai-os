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

## Versioning

- **Company skills** carry semver `version:` frontmatter (enforced by
  `scripts/validate.mjs`) plus a `## Changelog` section — bump the version
  and add a changelog line on every behavioral change; git review stays the
  change gate.
- **Agent definitions and company skills are Git-versioned authority.**
  Runtime-generated activation/materialization state is not.
- **Marketplace installs are pinned:** `.install.json` records
  owner/repo/ref and the branch-head `sha` at install time.
  `GET /api/marketplace/updates` compares the pin against the current head
  (`current` / `update_available` / `unpinned` for pre-contract installs)
  and flags `localModified` skills so upstream updates never clobber
  customizations silently.
- **Personal scopes** (`skills/personal*/`) carry their own **local-only**
  git repo (never gets a remote; the parent repo ignores the folder). The
  hub snapshots automatically on install; after manual edits, snapshot with
  plain `git add -A && git commit` inside that folder.

Validator boundary:

- `scripts/validate.mjs` enforces company skill metadata/version contracts and repo structure rules.
- It does not enforce runtime invocation-time authorization for skills/tools.

## Included company skills

- `company-onboarding` — guided interview that fills the company operating
  profile (custom instructions for the whole team)
- `personal-onboarding` — guided interview that creates a persona profile and
  per-user custom instructions (`CLAUDE.local.md`)
