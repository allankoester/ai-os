# Stage 1 Onboarding Runbook

Reproducible setup for one user on one machine. Target time: under 15 minutes.

## Prerequisites

- macOS / Linux / Windows with WSL
- Node.js 18+ (`node --version`)
- git
- Claude Code (CLI, desktop app or IDE extension), signed in

## Setup steps

1. **Get the software**

   ```bash
   git clone <steadymade-master repo url>
   cd steadymade-master/apps/internal/steadymade-ai-os
   ```

2. **Open as Claude Code project**

   Open this folder (`apps/internal/steadymade-ai-os`) in Claude Code. Confirm:

   - `CLAUDE.md` is loaded (project instructions)
   - subagents are listed from `.claude/agents/` (Atlas, Nora, Mara, Ada, Clara,
     Rosa, Otto, Dora, Vera, Noah, Kira, Jonas)

3. **Create your skills profile (Stage 2 contract)**

   ```bash
   cp profiles/_template.yml profiles/<your-name>.yml
   ```

   Fill in core / optional / excluded agents. See `profiles/README.md`.

4. **Initialize your private folders**

   `knowledge/personal/` and `runs/` are already gitignored. Put private notes
   only under `knowledge/personal/`. New unsorted material goes to
   `knowledge/inbox/` and is classified with Mara.

5. **Start the operating interface**

   ```bash
   node scripts/start.mjs
   # → http://localhost:4011
   ```

   macOS double-click wrapper: `./scripts/start-mac.command`  
   Windows double-click wrapper: `scripts\\start-windows.cmd`

6. **Validate the installation**

   ```bash
   node scripts/validate.mjs
   ```

   All checks must pass.

7. **Run the onboarding interviews**

   In Claude Code (this project):

   - `/personal-onboarding` — creates your private persona profile
     (`knowledge/personal/user-profile.md`) and your personal custom
     instructions (`CLAUDE.local.md`).
   - `/company-onboarding` — only if `operating-profile.md` (AI_OS root)
     still contains TODO placeholders (first team member does this once;
     later runs enrich it).

   Both skills are pre-activated. Manage skills in the interface → Skill Hub.

8. **Create your first backup**

   ```bash
   scripts/backup.sh backup
   ```

## First run (smoke test)

Ask Danny (main conversation):

> "Classify this request and show me the task brief you would send: draft a
> short LinkedIn post about measurable AI pilots."

Expected: Danny classifies `marketing_content_workflow`, produces a task brief
per `templates/task-brief.md`, and does not mark anything approved.

## Daily operating rules

- Company knowledge → `knowledge/company/<domain>/`, personal → `knowledge/personal/`, unsorted → `knowledge/inbox/`.
- External artifacts require the approval checklist (`templates/approval-checklist.md`).
- Significant runs get a run log in `runs/`.
- Back up before larger reorganizations: `scripts/backup.sh backup`.
- Stop interface cleanly: `node scripts/stop.mjs`.

## Backup and restore

- Create: `scripts/backup.sh backup` → `backups/ai-os-backup-<timestamp>.tar.gz`
- List: `scripts/backup.sh list`
- Restore: `scripts/backup.sh restore backups/ai-os-backup-<timestamp>.tar.gz`
  (overwrites current knowledge/runs/meta state with the archive)

Store at least one recent archive outside this machine (e.g. encrypted drive
or personal OneDrive) — the archive contains personal knowledge, so never in
the git repo or the company share.
